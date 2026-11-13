import { insist, str } from './security.js';

const extensions={image:'jpg|jpeg|png|webp|gif',video:'mp4|webm',audio:'mp3|wav'};
export function descriptionMedia(value) {
  insist(Array.isArray(value)&&value.length<=10,'Use up to 10 description media files.');
  return value.map(item=>{
    insist(item&&Object.hasOwn(extensions,item.type),'Choose image, video or audio.');
    const url=str(item.url,'Media URL',1,1200);
    const local=new RegExp('^/(assets|uploads)/[a-zA-Z0-9._-]+\\.('+extensions[item.type]+')$','i').test(url);
    let remote=false;
    try {const parsed=new URL(url);remote=parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!/[\\\s<>"']/.test(url);} catch {}
    insist(local||remote,'Use an uploaded file or a direct HTTPS media URL.');
    return {type:item.type,url,caption:str(item.caption||'','Media caption',0,500)};
  });
}

export function uploadedMedia(data) {
  let type,extension;
  if(data[0]===255&&data[1]===216&&data[2]===255){type='image';extension='jpg';}
  else if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){type='image';extension='png';}
  else if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'){type='image';extension='webp';}
  else if(['GIF87a','GIF89a'].includes(data.toString('ascii',0,6))){type='image';extension='gif';}
  else if(data.length>=16&&data.toString('ascii',4,8)==='ftyp'&&['isom','iso2','mp41','mp42','avc1','M4V ','MSNV'].includes(data.toString('ascii',8,12))){type='video';extension='mp4';}
  else if(data.subarray(0,4).equals(Buffer.from([26,69,223,163]))&&data.subarray(0,4096).includes(Buffer.from('webm'))){type='video';extension='webm';}
  else if(data.toString('ascii',0,3)==='ID3'||(data.length>=4&&data[0]===255&&(data[1]&0xe0)===0xe0&&(data[1]&0x06)!==0&&(data[2]&0xf0)!==0xf0&&(data[2]&0x0c)!==0x0c)){type='audio';extension='mp3';}
  else if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WAVE'){type='audio';extension='wav';}
  insist(type,'Upload a JPG, PNG, WebP, GIF, MP4, WebM, MP3 or WAV file.');
  insist(data.length<=(type==='image'?5:20)*1024*1024,type==='image'?'Images must be 5 MB or smaller.':'Video and audio files must be 20 MB or smaller.',413);
  return {type,extension};
}
