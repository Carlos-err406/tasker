import {expect,it} from 'vitest';
import {createTestDb,getRawDb} from '../src/db-node.js';
import {saveImage,getImage} from '../src/attachments.js';
it('stores image bytes with portable references without changing task records',()=>{
 const db=createTestDb();try {
 const bytes=Buffer.from('89504e470d0a1a0a00000000','hex');
 const image=saveImage(db,bytes,'image/png');
 expect(image.reference).toMatch(/^\/attachments\/[a-f0-9-]+$/);
 expect(Buffer.from(getImage(db,image.id)!.data)).toEqual(bytes);
 expect(getImage(db,image.id)!.mimeType).toBe('image/png');
 expect(getRawDb(db).prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({n:0});
 }finally{getRawDb(db).close();}
});
it('rejects empty, oversized, and unsupported images',()=>{
 const db=createTestDb();try {
 expect(()=>saveImage(db,Buffer.alloc(0),'image/png')).toThrow();
 expect(()=>saveImage(db,Buffer.alloc(10*1024*1024+1),'image/png')).toThrow();
 expect(()=>saveImage(db,Buffer.from('<svg/>'),'image/svg+xml')).toThrow();
 }finally{getRawDb(db).close();}
});
