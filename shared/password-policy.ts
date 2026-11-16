/** Portable offline policy. This deliberately small, curated blocklist rejects
 * common examples; it is NOT a complete breached-password corpus. No passwords
 * are sent to a third party. Extend this list through reviewed source changes.
 * Secrets are never trimmed/normalized before hashing. */
export const PASSWORD_MIN_LENGTH=12;
export const PASSWORD_MAX_LENGTH=1024;
export type PasswordIssue='PASSWORD_TOO_SHORT'|'PASSWORD_TOO_LONG'|'PASSWORD_COMMON'|'PASSWORD_UNCHANGED'|'PASSWORD_CONFIRMATION';
const common=new Set(['password','password123','password1234','password12345','password123456','123456789012','1234567890123456','qwerty12345678','qwertyuiop123','qwertyuiop123456','contraseña123','contrasena123','administrador','administrator','administrator123','admin12345678','welcome12345','changeme12345','letmein123456','iloveyou12345','correct horse battery staple']);
export function isCommonPassword(password:string):boolean {
 const candidate=password.normalize('NFKC').toLowerCase().trim();
 return candidate.length===0||common.has(candidate)||/^(.)\1+$/u.test(candidate)||/^(?:1234567890|0123456789|qwerty|password|123456)+$/u.test(candidate);
}
export function passwordIssues(password:string,confirmation?:string,current?:string):PasswordIssue[]{
 const issues:PasswordIssue[]=[];
 if(Array.from(password).length<PASSWORD_MIN_LENGTH)issues.push('PASSWORD_TOO_SHORT');
 // Maximum matches the historical HTTP UTF-16 length limit; no silent truncation.
 if(password.length>PASSWORD_MAX_LENGTH)issues.push('PASSWORD_TOO_LONG');
 if(isCommonPassword(password))issues.push('PASSWORD_COMMON');
 if(current!==undefined&&password===current)issues.push('PASSWORD_UNCHANGED');
 if(confirmation!==undefined&&password!==confirmation)issues.push('PASSWORD_CONFIRMATION');
 return issues;
}
export function passwordPolicyMessage(code:PasswordIssue):string {
 return {PASSWORD_TOO_SHORT:'Usá al menos 12 caracteres.',PASSWORD_TOO_LONG:'La contraseña supera el máximo de 1024 unidades de texto.',PASSWORD_COMMON:'Elegí una contraseña que no figure en la lista local de contraseñas comunes.',PASSWORD_UNCHANGED:'La nueva contraseña debe ser diferente de la actual.',PASSWORD_CONFIRMATION:'La confirmación debe coincidir exactamente con la nueva contraseña.'}[code];
}
