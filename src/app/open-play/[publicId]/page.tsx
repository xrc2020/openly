import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublicGame,siteOrigin,publicWhen } from '@/lib/open-play/public-game'
import PublicGameView from './PublicGameView'
import s from '@/app/components/platform.module.css'
export const dynamic='force-dynamic'
type Props={params:Promise<{publicId:string}>}
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {publicId}=await params,game=await getPublicGame(publicId)
 if(!game)return {title:'Open Play unavailable | Openly',robots:{index:false,follow:false}}
 const title=`${game.title} | Openly`,description=`Join ${game.host_name}'s pickleball Open Play · ${publicWhen(game.starts_at)} (PH time) · ${Number(game.fee)?`₱${game.fee}/player`:'Free entry'} · ${game.venue.name}`
 const url=`${siteOrigin()}/open-play/${game.public_id}`,image=`${url}/opengraph-image`
 return {title,description,alternates:{canonical:url},openGraph:{title,description,url,type:'website',siteName:'Openly',images:[{url:image,width:1200,height:630}]},twitter:{card:'summary_large_image',title,description,images:[image]}}
}
export default async function PublicGamePage({params}:Props){const game=await getPublicGame((await params).publicId);if(!game)notFound();return <main className={s.page}><header className={s.header}><Link className={s.brand} href="/">openly<span>.</span></Link><Link href="/">Explore games</Link></header><PublicGameView game={game}/><footer className={s.footer}>GOOD GAMES. NEW CONNECTIONS.</footer></main>}
