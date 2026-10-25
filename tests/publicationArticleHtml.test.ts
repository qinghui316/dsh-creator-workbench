import{mkdtemp,mkdir,writeFile,readFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join,dirname,extname}from'node:path';
import{afterEach,it,expect}from'vitest';
import{rm}from'node:fs/promises';
const folders:string[]=[];afterEach(async()=>{await Promise.all(folders.map(folder=>rm(folder,{recursive:true,force:true})));folders.length=0;});
import{snapshotPublicationArticle}from'../src/production/publicationArticle.ts';
it('rebases HTML with a leading layout comment when it is an independently edited publication body',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'creator-final-html-')),publicationDir=join(folder,'publication'),taskDir=join(folder,'upload');folders.push(folder);await mkdir(publicationDir);await mkdir(taskDir);
 const body='<!-- exported layout -->\n<!doctype html><html><body><p>Article</p><img src="one.png" alt="one"></body></html>';
 await writeFile(join(publicationDir,'body.md'),body);await writeFile(join(publicationDir,'one.png'),Buffer.from('image-bytes'));
 const saved=await snapshotPublicationArticle(folder,taskDir,{bodyFile:'publication/body.md'},body,[]);
 const result=await readFile(saved,'utf8');const src=result.match(/src="([^"]+)"/)![1]!;expect(await readFile(join(dirname(saved),src),'utf8')).toBe('image-bytes');expect(extname(saved)).toBe('.html');
});
