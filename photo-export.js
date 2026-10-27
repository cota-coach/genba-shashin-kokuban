import {embedJpegMetadata} from './jpeg-metadata.js';
const upgraded=new WeakMap();
// Older saved photos gain metadata in the exported copy, without rewriting storage.
export async function exportPhoto(photo) {
  if (photo.metadata.embeddedExifVersion===1) return photo;
  if (!upgraded.has(photo)) upgraded.set(photo,(async()=>{
    const metadata={...photo.metadata,embeddedExifVersion:1};
    return {...photo,metadata,composed:await embedJpegMetadata(photo.composed,metadata)};
  })());
  return upgraded.get(photo);
}
