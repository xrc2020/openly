export type Snapshot={provider:string;account_name:string;account_number:string;qr_path:string;payment_url?:string|null}
export type PaymentMethod=Snapshot&{enabled:boolean;session_url?:string|null;plus_url?:string|null}
export const paymentMethodName=(provider:string)=>({paymongo:'PayMongo · QR Ph',gcash:'GCash',maribank:'MariBank',maya:'Maya',bank_transfer:'Bank transfer'}[provider]??provider)
export type Order={id:string;host_id:string;product:string;open_play_id:string|null;amount:number;status:string;created_at:string;payment_reference:string|null;payment_snapshot:Snapshot}
export type Receipt={id:string;object_path:string;payment_reference:string;status:string;rejection_reason:string|null;submitted_at:string}

export const validPaymongoLink=(url?:string|null):url is string=>!!url&&/^https:\/\/paymongo\.page\/l\/[A-Za-z0-9_-]+$/.test(url)
