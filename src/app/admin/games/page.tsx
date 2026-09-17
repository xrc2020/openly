import AdminShell from '@/app/components/AdminShell'
import GameDirectory from './GameDirectory'
export default function Page(){return <AdminShell next="/admin/games"><GameDirectory/></AdminShell>}
