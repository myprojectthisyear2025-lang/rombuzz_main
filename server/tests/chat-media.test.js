const { test } = require('node:test'), assert = require('node:assert/strict'), mongoose = require('mongoose');
Object.assign(process.env, { NODE_ENV: 'test', R2_BUCKET_NAME: 'synthetic-test', R2_ACCESS_KEY_ID: 'synthetic', R2_SECRET_ACCESS_KEY: 'synthetic', R2_ENDPOINT: 'http://127.0.0.1:1' });
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User'), Match = require('../models/Match'), ChatRoom = require('../models/ChatRoom');
const { startBackend, stopBackend, request } = require('./integrationHelpers');
const { legacyFixture } = require('./fixtures');
const { getChatMediaPage, mediaPipeline } = require('../services/chatMediaQuery');
test('media projection, page signing, cursors, legacy payloads and access', {timeout:180000}, async t => {
  const mongo = await MongoMemoryServer.create({instance:{ip:'127.0.0.1'}}); let backend;
  t.after(async()=>{if(backend)await stopBackend(backend);await mongoose.disconnect();await mongo.stop();});
  const uri = mongo.getUri('media_fixture'); await mongoose.connect(uri,{autoIndex:false});
  const fixture=legacyFixture(); await User.insertMany(fixture.users); await Match.insertMany(fixture.matches);
  await ChatRoom.createIndexes();
  const messages = Array.from({length:167},(_,i)=>({id:`text${i}`,from:'alice',to:'bob',text:'x'.repeat(3000),time:new Date(1700000000000+i)}));
  for(let i=0;i<75;i++) messages.push({id:`media${i}`,from:'alice',to:'bob',url:`https://example.invalid/${i}.jpg`,mediaType:'image',time:new Date(1700000100000+i)});
  messages.push(
    {id:'legacy',from:'alice',to:'bob',text:'::RBZ::'+JSON.stringify({mediaType:'video',url:'https://example.invalid/old.mp4'}),time:new Date(1700000300000)},
    {id:'gift',from:'alice',to:'bob',url:'https://example.invalid/gift.jpg',gift:{priceBC:20,locked:false,unlockedBy:['bob']},time:new Date()},
    {id:'hidden',url:'https://example.invalid/hidden.jpg',hiddenFor:['bob']},
    {id:'deleted',url:'https://example.invalid/deleted.jpg',deleted:true},
    {id:'once',url:'https://example.invalid/once.jpg',ephemeral:{maxViews:1}},
    {id:'payload-once',text:'::RBZ::'+JSON.stringify({url:'https://example.invalid/payload-once.jpg',ephemeral:{mode:'twice'}})}
  );
  await ChatRoom.collection.insertOne({roomId:'alice_bob',participants:['alice','bob'],messages});
  const projected=(await ChatRoom.aggregate(mediaPipeline('alice_bob','bob')))[0].messages;
  assert.ok(!projected.some(m=>m.text?.startsWith('xxx'))); assert.ok(JSON.stringify(projected).length < JSON.stringify(messages).length/10);
  let signedCount=0;
  const page=await getChatMediaPage('alice_bob','bob',{limit:30},async items=>{signedCount+=items.length;return items;});
  assert.equal(signedCount,30); assert.equal(page.items.length,30); assert.equal(page.counts.image,75); assert.equal(page.counts.video,1);
  // A deleted cursor item must not make history inaccessible.
  await ChatRoom.updateOne({roomId:'alice_bob'},{$pull:{messages:{id:page.items.at(-1).id}}});
  const older=await getChatMediaPage('alice_bob','bob',{limit:60,before:page.nextCursor},async items=>items);
  assert.equal(older.items.length,45); assert.equal(older.hasMore,false);
  const purchased=await getChatMediaPage('alice_bob','bob',{kind:'purchased'},async items=>items);
  assert.equal(purchased.items.length,1); assert.equal(purchased.items[0].id,'gift'); assert.equal(purchased.items[0].giftPriceBC,20);
  const video=await getChatMediaPage('alice_bob','bob',{mediaType:'video'},async items=>items); assert.equal(video.items[0].id,'legacy');
  const explain=await ChatRoom.aggregate(mediaPipeline('alice_bob','bob')).explain('executionStats');
  assert.match(JSON.stringify(explain),/IXSCAN/);
  backend=await startBackend(uri);
  const http=await request(backend,'bob','/chat/rooms/alice_bob/media?limit=30'); assert.equal(http.items.length,30); assert.equal(http.counts.image,74);
  await request(backend,'carol','/chat/rooms/alice_bob/media',{status:403});
  await request(backend,'bob','/chat/rooms/alice_bob/media?before=bad',{status:400});
  await request(backend,'bob','/chat/rooms/alice_bob/media?kind=bogus',{status:400});
});
