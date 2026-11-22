import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { fail } from "./auth";
const REPLIT_SIDECAR_ENDPOINT="http://127.0.0.1:1106";
export const photoStorage=new Storage({credentials:{
  audience:"replit",subject_token_type:"access_token",token_url:`${REPLIT_SIDECAR_ENDPOINT}/token`,type:"external_account",
  credential_source:{url:`${REPLIT_SIDECAR_ENDPOINT}/credential`,format:{type:"json",subject_token_field_name:"access_token"}},universe_domain:"googleapis.com",
},projectId:""});
export const PHOTO_MAX=5*1024*1024;
export function privatePhotoFile(path:string){
  const dir=process.env.PRIVATE_OBJECT_DIR;
  if(!dir)fail(503,"Prywatne przechowywanie zdjęć nie jest skonfigurowane.");
  if(!path.startsWith(`${dir}/submission-photos/`))fail(404,"Nie znaleziono zdjęcia.");
  const [bucket,...parts]=path.replace(/^\//,"").split("/");
  return photoStorage.bucket(bucket!).file(parts.join("/"));
}
export async function photoUploadUrl(){
  const dir=process.env.PRIVATE_OBJECT_DIR;
  if(!dir)fail(503,"Przechowywanie zdjęć nie jest skonfigurowane.");
  const rawPath=`${dir}/submission-photos/staging/${randomUUID()}`;
  const [bucket,...parts]=rawPath.replace(/^\//,"").split("/");
  const response=await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,{
    method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(30000),
    body:JSON.stringify({bucket_name:bucket,object_name:parts.join("/"),method:"PUT",expires_at:new Date(Date.now()+10*60000).toISOString()})});
  if(!response.ok)fail(503,"Nie udało się przygotować miejsca na zdjęcie.");
  return {rawPath,uploadURL:(await response.json() as {signed_url:string}).signed_url};
}
export async function sanitizePhoto(rawPath:string,expectedSize:number,contentType:string){
  const file=privatePhotoFile(rawPath),[metadata]=await file.getMetadata();
  if(Number(metadata.size)!==expectedSize||Number(metadata.size)>PHOTO_MAX)fail(400,"Rozmiar zdjęcia nie zgadza się z deklaracją lub przekracza 5 MiB.");
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of file.createReadStream({start:0,end:PHOTO_MAX})){
    const bytes=Buffer.from(chunk);size+=bytes.length;
    if(size>PHOTO_MAX)fail(400,"Zdjęcie przekracza 5 MiB.");
    chunks.push(bytes);
  }
  if(size!==expectedSize)fail(400,"Niekompletne zdjęcie.");
  let cleaned:Buffer;
  try{
    const data=Buffer.concat(chunks);
    const signature=contentType==="image/png"?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
      contentType==="image/jpeg"?data.subarray(0,3).equals(Buffer.from([255,216,255])):
      contentType==="image/webp"&&data.toString("ascii",0,4)==="RIFF"&&data.toString("ascii",8,12)==="WEBP";
    if(!signature)fail(400,"Zawartość pliku nie odpowiada zadeklarowanemu typowi zdjęcia.");
    const image=sharp(data,{limitInputPixels:20000000,failOn:"warning"}),info=await image.metadata();
    if(({jpeg:"image/jpeg",png:"image/png",webp:"image/webp"} as Record<string,string>)[info.format??""]!==contentType||(info.pages??1)>1)
      fail(400,"Obsługujemy wyłącznie pojedyncze zdjęcia JPG, PNG i WebP.");
    cleaned=await image.rotate().resize({width:2400,height:2400,fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();
  }catch(error){if((error as {statusCode?:number}).statusCode)throw error;
    if((error as Error).message?.includes("pixel limit"))fail(400,"Zdjęcie przekracza 20 milionów pikseli. Zmniejsz jego rozdzielczość.");
    fail(400,"Plik nie jest poprawnym zdjęciem JPG, PNG lub WebP.");}
  // The signed staging URL can never overwrite the validated immutable private image.
  const objectPath=`${process.env.PRIVATE_OBJECT_DIR}/submission-photos/ready/${randomUUID()}.webp`;
  await privatePhotoFile(objectPath).save(cleaned!,{resumable:false,metadata:{contentType:"image/webp",cacheControl:"private, no-store"}});
  await file.delete({ignoreNotFound:true});
  return objectPath;
}
