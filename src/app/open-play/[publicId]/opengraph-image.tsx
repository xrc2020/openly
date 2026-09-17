import { ImageResponse } from 'next/og'
import { getPublicGame,publicWhen } from '@/lib/open-play/public-game'
export const dynamic='force-dynamic'
export const size={width:1200,height:630}
export const contentType='image/png'
export default async function Image({params}:{params:Promise<{publicId:string}>}){
 const game=await getPublicGame((await params).publicId)
 return new ImageResponse(<div style={{display:'flex',flexDirection:'column',justifyContent:'space-between',width:'100%',height:'100%',background:'#0a2027',color:'#eff7ee',padding:'60px',borderBottom:'12px solid #c0f65c'}}>
 <div style={{display:'flex',justifyContent:'space-between',fontSize:35,color:'#c0f65c'}}><span>openly.</span><span style={{fontSize:20}}>GOOD GAMES. NEW CONNECTIONS.</span></div>
 <div style={{display:'flex',flexDirection:'column',gap:20}}><div style={{fontSize:64,fontWeight:700,lineHeight:1.1}}>{game?.title.slice(0,95)??'Find your next Open Play'}</div><div style={{fontSize:27,color:'#bdd0cd'}}>{game?`${publicWhen(game.starts_at)} · Philippine time`:'Find your people. Play your game.'}</div><div style={{fontSize:27,color:'#bdd0cd'}}>{game?.venue.name.slice(0,80)??'Openly'}</div></div>
 <div style={{display:'flex',justifyContent:'space-between',fontSize:25}}><span>{game?`Hosted by ${game.host_name.slice(0,45)}`:'Pickleball Open Plays'}</span><span style={{color:'#c0f65c'}}>{game?Number(game.fee)?`PHP ${game.fee} / player`:'FREE ENTRY':'JOIN THE GAME'}</span></div></div>,size)
}
