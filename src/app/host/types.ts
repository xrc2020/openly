export type VenueOption = { id: string; name: string; address: string; city: string; google_maps_url: string | null; is_official: boolean; is_active: boolean }
export type PaymentOption = { id: string; provider: string; account_name: string; account_number: string; qr_path: string | null }
export type DraftGame = {
  court_count: number; id: string; title: string; description: string; venue_id: string; court_name: string | null;
  starts_at: string; ends_at: string; max_players: number; fee: number | string;
  skill_level: string; cancellation_cutoff: string | null; cancellation_policy: string; draft_payment_method_id: string | null;
}
