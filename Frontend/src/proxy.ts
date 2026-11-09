import { NextRequest, NextResponse } from 'next/server';

export function proxy(request:NextRequest){
  const nonce=Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64');
  const development=process.env.NODE_ENV==='development';
  // Inline React style attributes are used by the existing zoom/layout. Scripts
  // still require an unpredictable nonce; no unsafe-inline/eval in production.
  const csp=["default-src 'none'",`script-src 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}`,"script-src-attr 'none'",`style-src 'self' 'nonce-${nonce}'`,"style-src-attr 'unsafe-inline'","img-src 'self' blob: data:","font-src 'self'",`connect-src 'self'${development?' ws:':''}`,"frame-src blob:","worker-src 'none'","object-src 'none'","base-uri 'none'","form-action 'self'","frame-ancestors 'none'","manifest-src 'self'"].join('; ');
  const headers=new Headers(request.headers);headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',csp);
  const response=NextResponse.next({request:{headers}});response.headers.set('Content-Security-Policy',csp);response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/((?!api|_next/static|_next/image|favicon.ico|paysandu-original.png).*)']};
