export type {Role as InternalRole} from '../../../shared/permissions';
import type {Role as InternalRole} from '../../../shared/permissions';
export type AdminUser = { id:string; username:string; firstName?:string|null; lastName?:string|null; email?:string|null; ci?:string|null; role:InternalRole; enabled:boolean; mustChangePassword:boolean; revision:number; deletedAt:string|null };
export type AdminPage = {items:AdminUser[]; total:number; page:number; pageSize:number};
export type AdminResult = {user:AdminUser; requiresLogin?:boolean};
export type Expediente = {id:string; padCod:string; reference:string; name:string; documentType:string; mimeType:string; size:number; incorporatedAt:string; available:boolean};
export type ExpedientePage = {items:Expediente[];total:number;page:number;pageSize:number};
export {usernameKey as normalizedUsername,validUsername} from '../../../shared/user-profile';

export type AdminCapabilities={users:{list:boolean;edit:boolean;delete:boolean;create:boolean;resetPassword:boolean};audit:boolean;credentialDelivery:{available:boolean;code?:string;mode?:'administrator-input'}};
