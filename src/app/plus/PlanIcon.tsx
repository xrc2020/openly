export default function PlanIcon({name}:{name:'layers'|'ticket'|'crown'|'arrow'|'check'}){
 return <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 {name==='layers'?<><path d="m16 4 12 6-12 6L4 10Z" fill="currentColor" stroke="none"/><path d="m4 16 12 6 12-6M4 22l12 6 12-6"/></>:name==='ticket'?<path d="m12 3 5 5a4 4 0 0 0 6 6l5 5-9 9-5-5a4 4 0 0 0-6-6l-5-5Z"/>:name==='crown'?<><path d="m4 10 5 15h14l5-15-8 7-4-13-4 13Zm5 19h14"/><circle cx="4" cy="9" r="1.5" fill="currentColor"/><circle cx="16" cy="4" r="1.5" fill="currentColor"/><circle cx="28" cy="9" r="1.5" fill="currentColor"/></>:name==='arrow'?<path d="M5 16h22m-8-8 8 8-8 8"/>:<><circle cx="16" cy="16" r="14" fill="currentColor" stroke="none"/><path d="m9 16 5 5 9-10" stroke="var(--check-ink,#102820)" strokeWidth="2.5"/></>}
 </svg>
}
