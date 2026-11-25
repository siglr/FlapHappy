import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, unlinkSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalizePanelDestination,type PanelDestination,type PanelInstallResult,type PanelInstallStatus } from '../core/panel-install';

const PACKAGE_NAME='flaphappy-ingamepanel';
const OWNER='flaphappy-owner.txt';
const OWNER_TEXT='Flap Happy | flaphappy-ingamepanel';
const REQUIRED=['InGamePanels/FlapHappy.spb','html_ui/InGamePanels/FlapHappy/FlapHappy.html','html_ui/InGamePanels/FlapHappy/FlapHappy.css','html_ui/InGamePanels/FlapHappy/FlapHappy.js','html_ui/icons/toolbar/ICON_TOOLBAR_FLAPHAPPY.svg'];
const slash=(p:string)=>p.replace(/\\/g,'/');
const identity=(p:string)=>slash(resolve(p)).replace(/^\/\/\?\//,'').toLowerCase();
const same=(a:string,b:string)=>identity(a)===identity(b);
function beneath(root:string,p:string):boolean{const r=relative(root,p);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+(process.platform==='win32'?'\\':'/')));}
function errorText(e:unknown):string{return e instanceof Error?e.message:String(e);}
function lstat(p:string){return lstatSync(p,{throwIfNoEntry:false});}
function directory(p:string):boolean{try{return statSync(p).isDirectory();}catch{return false;}}
function versionOf(value:unknown):string|null{return typeof value==='string'&&/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)?value:null;}
export function comparePanelVersions(a:string,b:string):number{const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]<bb[i]?-1:1;}return 0;}
function manifest(root:string):Record<string,unknown>{const file=join(root,'manifest.json');const st=lstat(file);if(!st?.isFile()||st.isSymbolicLink()||st.size>1024*1024)throw Error('Missing or invalid manifest.json');return JSON.parse(readFileSync(file,'utf8'));}
function assertIdentity(m:Record<string,unknown>){if(m.title!=='Flap Happy'||m.manufacturer!=='Flap Happy'||m.creator!=='Flap Happy')throw Error('Package identity is not the Flap Happy toolbar panel');}
function payloadFiles(root:string,dir=root,out:string[]=[]):string[]{
  const info=lstat(dir);if(!info?.isDirectory()||info.isSymbolicLink())throw Error('Package directory is missing or is a link');
  for(const entry of readdirSync(dir)){
    const file=join(dir,entry),st=lstat(file);if(!st||st.isSymbolicLink())throw Error('Package contains a link: '+slash(relative(root,file)));
    if(st.isDirectory())payloadFiles(root,file,out);else if(st.isFile())out.push(slash(relative(root,file)));else throw Error('Unexpected package filesystem entry');
  }return out.sort();
}
function verifyPackage(root:string,allowed?:Set<string>):{version:string;files:string[]} {
  const files=payloadFiles(root);const m=manifest(root);assertIdentity(m);const version=versionOf(m.package_version);if(!version)throw Error('Missing or invalid package version');
  for(const name of REQUIRED){const st=lstat(join(root,name));if(!st?.isFile()||st.isSymbolicLink()||st.size===0)throw Error('Required panel asset is missing or empty: '+name);}
  if(files.includes(OWNER)&&readFileSync(join(root,OWNER),'utf8').trim()!==OWNER_TEXT)throw Error('Invalid package ownership marker');
  if(allowed){if(files.some(p=>!allowed.has(p)))throw Error('Installed folder contains additional files; review or move them manually before updating');validateKnownDirectories(root,allowed);}
  return {version,files};
}
export function findCommunity():string|null {
  const appData=process.env.APPDATA,local=process.env.LOCALAPPDATA;
  const cfgs=[appData&&join(appData,'Microsoft Flight Simulator 2024','UserCfg.opt'),local&&join(local,'Packages','Microsoft.Limitless_8wekyb3d8bbwe','LocalCache','UserCfg.opt')];
  for(const cfg of cfgs){if(!cfg)continue;try{const m=/^\s*InstalledPackagesPath\s+"([^"]+)"\s*$/mi.exec(readFileSync(cfg,'utf8'));if(m){for(const name of ['Community2024','Community']){const candidate=join(m[1],name);if(directory(candidate))return candidate;}}}catch{/* other install type */}}
  return null;
}

function communityRoots(detected:string|null):string[]{
  if(!detected)return [];
  const name=slash(detected).split('/').pop()?.toLowerCase();
  return (name==='community'||name==='community2024'?[join(dirname(detected),'Community2024'),join(dirname(detected),'Community')]:[detected]).filter(directory);
}
function physicalCommunities(detected:string|null):string[]{const result:string[]=[];for(const root of communityRoots(detected)){try{const actual=realpathSync(root);if(!result.some(p=>same(p,actual)))result.push(actual);}catch{/* inaccessible */}}return result;}
export function normalizeInstallDestination(input:PanelDestination,detected:string|null):PanelDestination{
  const choice=normalizePanelDestination(input);
  if(choice.kind==='custom'&&choice.customParent&&isAbsolute(choice.customParent)&&communityRoots(detected).some(root=>same(root,choice.customParent!)))return {kind:'community',customParent:null};
  return choice;
}

function linkedTarget(p:string):string|null {
  try{return realpathSync(p);}catch{try{return resolve(dirname(p),readlinkSync(p));}catch{return null;}}
}
function activePanels(roots:string[],target?:string):string[]{
  const result:string[]=[];
  for(const root of roots){
    for(const name of readdirSync(root)){
      const p=join(root,name),st=lstat(p);if(!st)continue;
      if(name.toLowerCase()===PACKAGE_NAME){result.push(p);continue;}
      if(st.isSymbolicLink()){
        const link=linkedTarget(p);if(!link)continue;
        if(target&&same(link,target)||slash(link).split('/').pop()?.toLowerCase()===PACKAGE_NAME){result.push(p);continue;}
      }
      // Other manifest-identifiable copies of this exact panel count as active, too.
      if(st.isDirectory()||st.isSymbolicLink()){try{const actual=realpathSync(p);if(!lstat(join(actual,REQUIRED[0]))?.isFile())continue;assertIdentity(manifest(actual));result.push(p);}catch{/* unrelated or broken package */}}
    }
  }
  return result;
}
type Inspection={status:PanelInstallStatus;targetParent:string|null;bundleFiles:Set<string>};
function inspect(bundle:string,input:PanelDestination,detected:string|null):Inspection {
  const choice=normalizeInstallDestination(input,detected),roots=physicalCommunities(detected);
  const status:PanelInstallStatus={state:'unavailable',destination:choice,installed:false,canRemove:false,community:detected,target:null,bundledVersion:null,installedVersion:null,linked:null,action:null,message:''};
  const unavailable=(state:PanelInstallStatus['state'],message:string):Inspection=>({status:{...status,state,message,action:null,canRemove:false},targetParent:null,bundleFiles:new Set()});
  let source:{version:string;files:string[]}|null=null,bundleError:string|null=null;
  try{source=verifyPackage(bundle);status.bundledVersion=source.version;}catch(e){bundleError='Bundled panel is invalid: '+errorText(e);}
  const allowed=new Set((source?.files??REQUIRED.concat('manifest.json',OWNER)).concat('layout.json'));
  const named=roots.map(root=>join(root,PACKAGE_NAME)).filter(p=>!!lstat(p));
  let active=activePanels(roots,choice.customParent?join(choice.customParent,PACKAGE_NAME):undefined);
  if(active.length>1)return unavailable('conflict','Flap Happy is present in multiple Community folders. Resolve the duplicate manually.');
  const selected=choice.kind==='community'?(named.length?dirname(named[0]):roots[0]):choice.customParent;
  if(!selected||!isAbsolute(selected)||!directory(selected))return unavailable('unavailable',choice.kind==='community'?'MSFS 2024 Community folder was not detected. Select a custom package parent.':'Browse for an existing custom package parent.');
  let parent:string;try{parent=realpathSync(selected);}catch(e){return unavailable('unavailable','Cannot resolve destination: '+errorText(e));}
  if(choice.kind==='custom'&&!same(parent,selected))return unavailable('conflict','Select the actual physical custom package parent, not a redirected path.');
  if(choice.kind==='custom'&&roots.some(root=>beneath(root,parent)))return unavailable('conflict','Choose a custom package parent outside Community.');
  if(beneath(bundle,parent)||same(join(parent,PACKAGE_NAME),bundle))return unavailable('conflict','The bundled package cannot be an installation target.');
  // Do not nest a package within an existing package tree.
  for(let current=parent;;current=dirname(current)){if(lstat(join(current,'manifest.json')))return unavailable('conflict','Select a package parent, not a folder inside another package.');if(dirname(current)===current)break;}
  const target=join(parent,PACKAGE_NAME);status.target=target;active=activePanels(roots,target);
  if(active.length>1)return unavailable('conflict','Flap Happy is present more than once in Community. Resolve the duplicate manually.');
  if(roots.length){status.linked=false;for(const item of active){const st=lstat(item)!;
    if(st.isSymbolicLink()){
      const link=linkedTarget(item);
      if(choice.kind==='custom'&&link&&same(link,target)){status.linked=true;}
      else return unavailable('conflict','Community contains a different or unavailable linked Flap Happy package. Use Addons Linker to unlink it and select the physical package parent.');
    }else if(!same(item,target))return unavailable('conflict','A physical Flap Happy package already exists in Community. Remove it from its selected location before using a custom destination.');
  }}
  const existing=lstat(target);
  if(existing?.isSymbolicLink()||existing&&!existing.isDirectory())return unavailable('conflict','Selected package target is not an ordinary physical directory.');
  if(existing){try{const m=manifest(target);assertIdentity(m);status.installed=true;status.installedVersion=versionOf(m.package_version);verifyPackage(target,allowed);verifyLayout(target);status.canRemove=status.linked===false||status.linked===null;}catch(e){return unavailable('cannot-verify','Existing package cannot be safely updated or removed: '+errorText(e));}}
  if(bundleError)return unavailable('unavailable',bundleError);
  if(!existing){status.state='not-installed';status.action='Install';status.message='Not installed';}
  else{const cmp=comparePanelVersions(status.installedVersion!,source!.version);if(cmp<0){status.state='update-available';status.action='Update';status.message='Update available';}else if(cmp===0){status.state='up-to-date';status.message='Up to date';}else{status.state='newer-installed';status.message='Newer version installed; no downgrade offered';}}
  if(status.linked===true)status.message+=' · Linked in Community (unlink before removal)';else if(choice.kind==='custom')status.message+=roots.length?' · Not linked in Community':' · Community link status unknown';
  return {status,targetParent:parent,bundleFiles:allowed};
}
export function panelInstallStatus(bundle:string,choice:PanelDestination,community:string|null=findCommunity()):PanelInstallStatus{try{return inspect(bundle,choice,community).status;}catch(e){return {state:"unavailable",destination:normalizePanelDestination(choice),installed:false,canRemove:false,community,target:null,bundledVersion:null,installedVersion:null,linked:null,action:null,message:errorText(e)};}}

function stagingRoot(parent:string,community:string|null):string {
  const candidates=[dirname(parent),tmpdir(),parent];
  const dev=statSync(parent).dev;
  for(const candidate of candidates){try{const actual=realpathSync(candidate);if(physicalCommunities(community).some(root=>beneath(root,actual)))continue;if(statSync(actual).dev!==dev)continue;return mkdtempSync(join(actual,'.flaphappy-stage-'));}catch{/* try another directory on same destination volume */}}
  throw Error('Cannot create a staging directory on the destination volume outside Community. The existing package is unchanged.');
}
function copyPayload(bundle:string,stage:string,files:string[]){mkdirSync(stage);for(const rel of files){if(rel==='layout.json')continue;const to=join(stage,rel);mkdirSync(dirname(to),{recursive:true});writeFileSync(to,readFileSync(join(bundle,rel)));if(rel!=='manifest.json'&&digest(to)!==digest(join(bundle,rel)))throw Error('Staged panel verification failed: '+rel);}}
function digest(file:string):string{return createHash('sha256').update(readFileSync(file)).digest('hex');}
function writeLayout(root:string){const files=payloadFiles(root).filter(p=>p!=='layout.json'&&p!=='manifest.json');const rows=files.map(path=>{const st=statSync(join(root,path));return {path,size:st.size,date:((BigInt(Math.round(st.mtimeMs))+11644473600000n)*10000n).toString()};});const m=manifest(root);m.total_package_size=String(rows.reduce((n,r)=>n+r.size,0)).padStart(20,'0');writeFileSync(join(root,'manifest.json'),JSON.stringify(m,null,2));writeFileSync(join(root,'layout.json'),'{\n  "content": [\n'+rows.map(r=>`    { "path": ${JSON.stringify(r.path)}, "size": ${r.size}, "date": ${r.date} }`).join(',\n')+'\n  ]\n}\n');}

function validateKnownDirectories(root:string,allowed:Set<string>,dir=root):void{
 for(const entry of readdirSync(dir)){const p=join(dir,entry),st=lstat(p);if(!st||st.isSymbolicLink())throw Error('Unexpected linked package entry');if(st.isDirectory()){const rel=slash(relative(root,p))+'/';if(![...allowed].some(f=>f.startsWith(rel)))throw Error('Unknown folder in package: '+rel);validateKnownDirectories(root,allowed,p);}}
}
function cleanupOwnedTree(root:string,allowed:Set<string>):void{
 const files=payloadFiles(root);if(files.some(f=>!allowed.has(f)))throw Error('Unexpected files were retained for review');validateKnownDirectories(root,allowed);
 for(const file of files)unlinkSync(join(root,file));
 const removeEmpty=(p:string)=>{for(const n of readdirSync(p))removeEmpty(join(p,n));rmdirSync(p);};removeEmpty(root);
}
function cleanupStage(stage:string,allowed:Set<string>){
 const st=lstat(stage);if(!st?.isDirectory()||st.isSymbolicLink()||!slash(stage).split('/').pop()?.startsWith('.flaphappy-stage-'))throw Error('Staging directory changed');
 for(const n of readdirSync(stage)){if(!['new-package','previous-package','failed-package'].includes(n))throw Error('Unexpected staging entry retained');cleanupOwnedTree(join(stage,n),allowed);}rmdirSync(stage);
}
function verifyLayout(root:string){
 const text=readFileSync(join(root,'layout.json'),'utf8'),layout=JSON.parse(text) as {content?:Array<{path:string;size:number}>};
 const expected=payloadFiles(root).filter(p=>p!=='manifest.json'&&p!=='layout.json');
 if(!Array.isArray(layout.content)||layout.content.length!==expected.length||new Set(layout.content.map(e=>e.path)).size!==expected.length||layout.content.some(e=>!expected.includes(e.path)||e.size!==statSync(join(root,e.path)).size))throw Error('Generated layout did not match the staged panel');
}
export function simulatorRunning():boolean{
 if(process.platform!=='win32')return false;
 const text=execFileSync('tasklist.exe',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true,timeout:4000});
 return /(?:^|\r?\n)"FlightSimulator(?:2024)?\.exe",/i.test(text);
}
function ensureSimulatorClosed(check:()=>boolean){try{if(check())throw Error('running');}catch{throw Error('Close MSFS before installing, updating or removing the toolbar panel (or its process state could not be confirmed).');}}
/** Stage and verify before swapping, with rollback on failure. The optional
 * operations are injected only by isolated tests; the app uses real filesystem calls. */
export function installCockpitPanel(bundle:string,choice:PanelDestination,community:string|null=findCommunity(),rename=renameSync,isRunning=simulatorRunning):PanelInstallResult {
  let first:Inspection;try{first=inspect(bundle,choice,community);}catch(e){const status=panelInstallStatus(bundle,choice,community);return {ok:false,message:errorText(e),status};}const status=first.status;
  if(!status.action||!first.targetParent||!status.target)return {ok:false,message:status.message,status};
  const parent=first.targetParent,target=status.target;let stageRoot:string|null=null,backup:string|null=null,oldMoved=false,newMoved=false,keepStage=false;
  let ok=false,message='';
  try{
    ensureSimulatorClosed(isRunning);
    stageRoot=stagingRoot(parent,community);const staged=join(stageRoot,'new-package');backup=join(stageRoot,'previous-package');
    const source=verifyPackage(bundle);copyPayload(bundle,staged,source.files);writeLayout(staged);verifyPackage(staged,first.bundleFiles);verifyLayout(staged);
    const check=inspect(bundle,choice,community).status;
    if(!check.action||check.action!==status.action||check.target!==target||check.installedVersion!==status.installedVersion||check.bundledVersion!==status.bundledVersion||check.linked!==status.linked)throw Error('Installation or link changed during staging; try again.');
    ensureSimulatorClosed(isRunning);
    if(lstat(target)){rename(target,backup);oldMoved=true;}
    rename(staged,target);newMoved=true;
    const installed=verifyPackage(target,first.bundleFiles);verifyLayout(target);if(installed.version!==status.bundledVersion)throw Error('Installed version did not match the bundle');
    const confirmed=inspect(bundle,choice,community).status;if(confirmed.state!=='up-to-date'||confirmed.target!==target||confirmed.linked!==status.linked)throw Error('The installation or Community link changed during the swap');
    ensureSimulatorClosed(isRunning);
    ok=true;message=(status.action==='Update'?'Updated':'Installed')+' Flap Happy panel at '+target+(status.destination.kind==='custom'?' (link it with Addons Linker if not already linked).':'.');
  }catch(e){message=errorText(e);try{if(newMoved){verifyPackage(target,first.bundleFiles);const failed=join(stageRoot!,'failed-package');rename(target,failed);}if(oldMoved&&backup)rename(backup,target);}catch(rollback){keepStage=true;message+=' Rollback could not complete: '+errorText(rollback)+'. Preserved recovery files at '+stageRoot;}}
  finally{if(stageRoot&&!keepStage){try{cleanupStage(stageRoot,first.bundleFiles);}catch(e){message+=' Temporary recovery folder remains at '+stageRoot+' ('+errorText(e)+').';}}}
  return {ok,message,status:panelInstallStatus(bundle,choice,community)};
}
export function removeCockpitPanel(bundle:string,choice:PanelDestination,community:string|null=findCommunity(),rename=renameSync,isRunning=simulatorRunning):PanelInstallResult{
 let first:Inspection;try{first=inspect(bundle,choice,community);}catch(e){const status=panelInstallStatus(bundle,choice,community);return {ok:false,message:errorText(e),status};}const status=first.status;
 if(!status.canRemove||!status.installed||!status.target||!first.targetParent)return {ok:false,message:status.linked?'Unlink the panel in Addons Linker before removal.':status.message,status};
 const target=status.target;let stage:string|null=null,backup:string|null=null,moved=false,keep=false,ok=false,message='';
 try{
  ensureSimulatorClosed(isRunning);stage=stagingRoot(first.targetParent,community);backup=join(stage,'previous-package');
  const recheck=inspect(bundle,choice,community).status;if(!recheck.canRemove||recheck.target!==target||recheck.installedVersion!==status.installedVersion)throw Error('Package or link changed before removal.');
  ensureSimulatorClosed(isRunning);rename(target,backup);moved=true;
  if(activePanels(physicalCommunities(community),target).length)throw Error('A Community package or link appeared during removal. Restore it and unlink before retrying.');
  ensureSimulatorClosed(isRunning);ok=true;message='Removed the verified Flap Happy panel from '+target;
 }catch(e){message=errorText(e);if(moved&&backup){try{rename(backup,target);}catch(rollback){keep=true;message+=' Rollback failed: '+errorText(rollback)+'. Recovery package retained at '+backup;}}}
 finally{if(stage&&!keep){try{cleanupStage(stage,first.bundleFiles);}catch(e){message+=' Recovery folder retained at '+stage+' ('+errorText(e)+').';}}}
 return {ok,message,status:panelInstallStatus(bundle,choice,community)};
}
