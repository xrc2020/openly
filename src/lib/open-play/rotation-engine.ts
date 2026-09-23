export type RotationPlayer={id:string;user_id:string;display_name:string}
export type Assignment={player_id:string;court:number;team:number;display_name?:string;user_id?:string}
export type RotationSettings={style:'manual'|'social'|'competitive';courts:number;round_type:'timed'|'score';minutes:number;target:number;win_by:number;score_cap:number|null;version:number}
export type RotationRound={court_number?:number|null;id:string;number:number;status:'draft'|'live'|'completed'|'aborted';kind:'regular'|'semifinal'|'final';version:number;settings:RotationSettings;started_at:string|null;completed_at:string|null;assignments:Assignment[];matches:{court:number;a:number|null;b:number|null}[]}
export type PlayerStats={id:string;name:string;games:number;rests:number;wins:number;losses:number;draws:number;pf:number;pa:number;minutes:number;partners:Set<string>;opponents:Set<string>;courts:Record<number,number>}
const pair=(a:string,b:string)=>[a,b].sort().join('|')
export function calculatePlayerHistory(players:RotationPlayer[],rounds:RotationRound[]){
 const stats=new Map<string,PlayerStats>(),partners=new Map<string,number>(),opponents=new Map<string,number>()
 function ensure(id:string,name:string){if(!stats.has(id))stats.set(id,{id,name,games:0,rests:0,wins:0,losses:0,draws:0,pf:0,pa:0,minutes:0,partners:new Set(),opponents:new Set(),courts:{}});return stats.get(id)!}
 players.forEach(p=>ensure(p.id,p.display_name))
 for(const r of rounds.filter(r=>r.status==='completed'&&r.kind==='regular')){
  const duration=r.started_at&&r.completed_at?Math.max(0,(Date.parse(r.completed_at)-Date.parse(r.started_at))/60000):0
  for(const a of r.assignments){const st=ensure(a.player_id,a.display_name??'Player');if(!a.court){st.rests++;continue}st.games++;st.minutes+=duration;st.courts[a.court]=(st.courts[a.court]??0)+1
   for(const b of r.assignments.filter(b=>b.court===a.court&&b.player_id!==a.player_id)){const together=a.team===b.team;(together?st.partners:st.opponents).add(b.player_id);if(a.player_id<b.player_id){const map=together?partners:opponents,key=pair(a.player_id,b.player_id);map.set(key,(map.get(key)??0)+1)}}
   const m=r.matches.find(m=>m.court===a.court);if(m?.a!=null&&m.b!=null){const pf=a.team===1?m.a:m.b,pa=a.team===1?m.b:m.a;st.pf+=pf;st.pa+=pa;if(pf>pa)st.wins++;else if(pf<pa)st.losses++;else st.draws++}
  }
 }
 return {stats,partners,opponents}
}
export function calculateLeaderboard(players:RotationPlayer[],rounds:RotationRound[]){
 const {stats}=calculatePlayerHistory(players,rounds)
 const sorted=[...stats.values()].sort((a,b)=>b.wins-a.wins||(b.pf-b.pa)-(a.pf-a.pa)||b.pf-a.pf||a.id.localeCompare(b.id))
 let rank=1;return sorted.map((p,i)=>{const prev=sorted[i-1];if(i&&!(p.wins===prev.wins&&p.pf-p.pa===prev.pf-prev.pa&&p.pf===prev.pf))rank=i+1;return {...p,rank}})
}
function random(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
/** Games played and last-round rest take priority over partner/opponent variety.
 * A deterministic seed lets tests and retries reproduce a layout. */
export function generateNextRound(players:RotationPlayer[],rounds:RotationRound[],courts:number,seed=1):Assignment[]{
 if(players.length<4)throw Error('At least four confirmed players are needed.')
 const history=calculatePlayerHistory(players,rounds),rand=random(seed),last=rounds.filter(r=>r.status==='completed'&&r.kind==='regular').at(-1)
 const rested=new Set(last?.assignments.filter(a=>!a.court).map(a=>a.player_id)??[])
 const lastPlayed=(id:string)=>Math.max(0,...rounds.filter(r=>r.status==='completed'&&r.assignments.some(a=>a.player_id===id&&a.court>0)).map(r=>Date.parse(r.completed_at??'')||0))
 const priority=players.map(p=>({p,tie:rand()})).sort((a,b)=>history.stats.get(a.p.id)!.games-history.stats.get(b.p.id)!.games||Number(rested.has(b.p.id))-Number(rested.has(a.p.id))||lastPlayed(a.p.id)-lastPlayed(b.p.id)||a.tie-b.tie)
 const count=Math.min(courts,Math.floor(players.length/4))*4,chosen=priority.slice(0,count).map(x=>x.p),rest=priority.slice(count).map(x=>({player_id:x.p.id,court:0,team:0}))
 let best:Assignment[]=[],bestCost=Infinity
 // Evaluate several pairings; history has priority, and ties spread courts.
 for(let attempt=0;attempt<80;attempt++){
  const pool=[...chosen];for(let i=pool.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  const layout:Assignment[]=[],courtOrder=Array.from({length:courts},(_,i)=>i+1);let cost=0
  for(let i=courtOrder.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[courtOrder[i],courtOrder[j]]=[courtOrder[j],courtOrder[i]]}
  for(let i=0;i<pool.length;i+=4){const court=courtOrder[i/4],g=pool.slice(i,i+4);for(let j=0;j<4;j++){layout.push({player_id:g[j].id,court,team:j<2?1:2});cost+=(history.stats.get(g[j].id)!.courts[court]??0)*0.1;for(let k=j+1;k<4;k++){const together=(j<2)===(k<2);cost+=((together?history.partners:history.opponents).get(pair(g[j].id,g[k].id))??0)*(together?10:1)}}}
  if(cost<bestCost){bestCost=cost;best=layout}
 }
 return [...best,...rest]
}
/** Championship is optional. Tied seeds use stable IDs; hosts can swap before start. */
export function championshipLayout(players:RotationPlayer[],rounds:RotationRound[],size:4|8):Assignment[]{
 const eligible=new Set(players.map(p=>p.id)),ranked=calculateLeaderboard(players,rounds).filter(p=>eligible.has(p.id)&&p.games>0).slice(0,size)
 if(ranked.length<size)throw Error(`Complete qualifying rounds with at least ${size} confirmed players first.`)
 const ids=ranked.map(p=>p.id),teams=size===4?[[ids[0],ids[3]],[ids[1],ids[2]]]:[[ids[0],ids[7]],[ids[3],ids[4]],[ids[1],ids[6]],[ids[2],ids[5]]]
 const layout=teams.flatMap((team,i)=>team.map(player_id=>({player_id,court:Math.floor(i/2)+1,team:i%2+1})))
 return [...layout,...players.filter(p=>!ids.includes(p.id)).map(p=>({player_id:p.id,court:0,team:0}))]
}
export function finalLayout(players:RotationPlayer[],semi:RotationRound):Assignment[]{
 const teams=semi.matches.map(m=>{if(m.a==null||m.b==null||m.a===m.b)throw Error('Complete both semifinals with a winner first.');const winner=m.a>m.b?1:2;return semi.assignments.filter(a=>a.court===m.court&&a.team===winner)})
 if(teams.length!==2||teams.some(t=>t.length!==2)||teams.flat().some(a=>!players.some(p=>p.id===a.player_id)))throw Error('Both winning teams must still be confirmed.')
 const layout=teams.flatMap((t,i)=>t.map(a=>({player_id:a.player_id,court:1,team:i+1})))
 return [...layout,...players.filter(p=>!layout.some(a=>a.player_id===p.id)).map(p=>({player_id:p.id,court:0,team:0}))]
}

/** Drafts reserve players too, so review/start cannot double-book another court. */
export function generateCourtRound(players:RotationPlayer[],rounds:RotationRound[],court:number,seed=1):Assignment[]{
 const occupied=new Set(rounds.filter(r=>r.status==='live'||r.status==='draft').flatMap(r=>r.assignments.filter(a=>a.court>0).map(a=>a.player_id)))
 const available=players.filter(p=>!occupied.has(p.id))
 if(available.length<4)throw Error('At least four available players are needed. Complete another court’s round first.')
 return generateNextRound(available,rounds,1,seed).filter(a=>a.court>0).map(a=>({...a,court}))
}
