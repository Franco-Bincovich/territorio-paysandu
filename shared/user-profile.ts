/** Canonical identity keys are persisted as UTF-8 bytes, never compared using an
 * accent-insensitive SQL collation. Preserve display spelling separately. */
export const usernameKey=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
export const emailKey=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
export function validUsername(value:string){return value.normalize('NFKC').trim().length<=100&&usernameKey(value).length<=100&&/^[\p{L}\p{N}._@-]{1,100}$/u.test(value.normalize('NFKC').trim())&&BufferlessLength(usernameKey(value))<=100;}
const BufferlessLength=(value:string)=>Array.from(value).length;
export function validEmail(value:string){return value.length<=254&&/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(value);}
/** Format only: 7–8 digits, optionally written with dots/hyphen. No invented
 * checksum policy and no rewriting historical values during migration. */
export function normalizeCi(value:string){const text=value.trim();if(!text)return null;if(!/^(?:\d{7,8}|\d{6,7}-\d|\d{1,2}\.\d{3}\.\d{3}-\d)$/.test(text))throw Error('CI');const digits=text.replace(/[.-]/g,'');if(!/^\d{7,8}$/.test(digits))throw Error('CI');return digits;}
