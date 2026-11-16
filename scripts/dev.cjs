// Reuse the explicit local MariaDB launcher when its configuration exists.
// Never infer a provider from credentials or silently fall back after failure.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function command(exists=fs.existsSync){
 return exists(path.join(root,'Backend/server/mariadb/.env.local'))
  ? [path.join(root,'scripts/dev-mariadb.cjs')]
  : [path.join(root,'node_modules/next/dist/bin/next'),'dev','Frontend','--hostname','127.0.0.1'];
}
if(require.main===module){
 const child=spawn(process.execPath,command(),{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 child.on('error',()=>{console.error('No se pudo iniciar el entorno local.');process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;});
 process.on('SIGINT',()=>child.kill('SIGINT'));
 process.on('SIGTERM',()=>child.kill('SIGTERM'));
}
module.exports={command};
