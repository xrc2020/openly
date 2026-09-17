import 'server-only'
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type PublicGame = {
  public_id:string; title:string; description:string; host_name:string; starts_at:string; ends_at:string
  status:string; max_players:number; fee:number; skill_level:string; court_name:string|null; cancellation_policy:string
  play_style:string; reserved_slots:number; remaining_slots:number
  venue:{name:string;address:string;city:string;google_maps_url:string|null;latitude:null;longitude:null}
}
export function siteOrigin() { return new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').origin }
export const getPublicGame = cache(async (id:string):Promise<PublicGame|null> => {
  if(!UUID.test(id))return null
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
    auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})},
  })
  const r=await db.rpc('openly_public_game',{p_public:id})
  if(r.error)throw new Error('Unable to load this Open Play. Please retry.')
  return r.data as PublicGame|null
})
export const publicWhen=(value:string)=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
