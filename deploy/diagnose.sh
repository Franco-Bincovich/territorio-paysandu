#!/bin/sh
# Read-only diagnostics. Never prints Config.Env, credentials, sessions or dataset names.
set -eu
container=${1:-territorio-paysandu}
docker inspect --format 'name={{.Name}} image={{.Image}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} memory={{.HostConfig.Memory}} cpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container"
docker inspect --format '{{range .Mounts}}target={{.Destination}} type={{.Type}} writable={{.RW}}{{println}}{{end}}' "$container"
docker exec "$container" node -e '
const fs=require("node:fs"),net=require("node:net"),http=require("node:http");
const reachable=(host,port)=>new Promise(resolve=>{let done=false;const socket=net.createConnection({host,port}),finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.setTimeout(3000,()=>finish(false));socket.once("connect",()=>finish(true));socket.once("error",()=>finish(false));});
(async()=>{const out={uid:process.getuid(),provider:process.env.IMAGE_PROVIDER,databases:[]};
for(const prefix of ["MARIADB","INSTITUTIONAL"]){const available=await reachable(process.env[prefix+"_HOST"],Number(process.env[prefix+"_PORT"]||3306));out.databases.push({connection:prefix,tcpReachable:available,sqlAndTlsNotProvenByTcp:true});if(!available)process.exitCode=1;}
const origin=new URL(process.env.APP_ORIGIN);
out.unauthenticatedSessionStatus=await new Promise(resolve=>{const request=http.get({host:"127.0.0.1",port:Number(process.env.PORT||3000),path:"/api/session",headers:{host:origin.host,origin:origin.origin,"x-forwarded-proto":origin.protocol.slice(0,-1),"x-forwarded-host":origin.host,"x-tp-proxy-token":process.env.SECURITY_PROXY_SECRET||"","x-tp-client-ip":"127.0.0.1"}},response=>{response.resume();response.once("end",()=>resolve(response.statusCode));});request.setTimeout(5000,()=>request.destroy());request.once("error",()=>resolve(0));});
out.standaloneOwnDbGuardPassed=process.env.SECURITY_RATE_LIMIT_PROVIDER==="standalone"&&out.unauthenticatedSessionStatus===401;if(!out.standaloneOwnDbGuardPassed)process.exitCode=1;
if(out.provider==="filesystem"){out.directories=[];for(const [key,fallback]of [["SURVEY","actuales"],["HISTORICAL","historicas"]]){try{fs.accessSync(process.env["FILESYSTEM_IMAGES_"+key+"_DIRECTORY"]||"/data/imagenes/"+fallback,fs.constants.R_OK|fs.constants.X_OK);out.directories.push({kind:key,readable:true});}catch{out.directories.push({kind:key,readable:false});process.exitCode=1;}}}
if(out.provider==="sftp")out.sftpConfigurationPresent=process.env.SFTP_IMAGES_ENABLED==="true"&&!!process.env.SFTP_IMAGES_HOST&&!!process.env.SFTP_IMAGES_HOST_KEY_SHA256;
console.log(JSON.stringify(out));})().catch(()=>{console.error("Diagnostic unavailable; sensitive details omitted.");process.exitCode=1;});'
