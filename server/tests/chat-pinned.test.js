const { test } = require('node:test'), assert = require('node:assert/strict'), mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User'), Match = require('../models/Match'), ChatRoom = require('../models/ChatRoom');
const { startBackend, stopBackend, request } = require('./integrationHelpers');
const { legacyFixture } = require('./fixtures');
const { getPinnedMessages, pinnedPipeline } = require('../services/chatPinnedQuery');

test('focused pins project a long room, preserve metadata/order, avoid signing, and enforce access', { timeout: 180000 }, async t => {
  const mongo = await MongoMemoryServer.create({instance:{ip:'127.0.0.1'}}); let backend;
  t.after(async()=>{if(backend)await stopBackend(backend);await mongoose.disconnect();await mongo.stop();});
  const uri=mongo.getUri('pinned_fixture'); await mongoose.connect(uri,{autoIndex:false});
  const fixture=legacyFixture(); await User.insertMany(fixture.users); await Match.insertMany(fixture.matches); await ChatRoom.createIndexes();
  const messages=Array.from({length:1200},(_,i)=>({id:`history${i}`,from:'alice',to:'bob',text:'x'.repeat(2000),time:new Date(1700000000000+i)}));
  const pins=Array.from({length:8},(_,i)=>({id:`pin${i}`,from:'alice',to:'bob',text:`Pin ${i}`,pinned:true,pinnedAt:new Date(1700000100000+i),replyTo:{id:'history1',text:'reply'},reactions:{alice:'heart'}}));
  Object.assign(pins[7],{text:'',type:'media',mediaType:'video',url:'chat/video.mp4',streamUid:'synthetic-stream',thumbnailUrl:'chat/poster.jpg'});
  messages.push(...pins,
    {id:'hidden',pinned:true,hiddenFor:['bob']},{id:'deleted',pinned:true,deleted:true},{id:'temp',pinned:true,_temp:true},
    {id:'duplicate',pinned:true},{id:'duplicate',pinned:false});
  await ChatRoom.collection.insertOne({roomId:'alice_bob',participants:['alice','bob'],messages});
  const projected=(await ChatRoom.aggregate(pinnedPipeline('alice_bob','bob')))[0].messages;
  const result=await getPinnedMessages('alice_bob','bob');
  assert.equal(result.messages.length,8);assert.equal(result.messages[0].id,'pin7');
  assert.equal(result.messages[0].streamUid,'synthetic-stream');assert.equal(result.messages[0].url,'chat/video.mp4');
  assert.deepEqual(result.messages[0].replyTo,pins[7].replyTo);assert.deepEqual(result.messages[0].reactions,pins[7].reactions);
  assert.ok(!projected.some(m=>m.id.startsWith('history')));
  const before=Buffer.byteLength(JSON.stringify(messages)),projection=Buffer.byteLength(JSON.stringify(projected)),after=Buffer.byteLength(JSON.stringify(result));
  assert.ok(after<before/100);t.diagnostic(JSON.stringify({historyRows:messages.length,projectedRows:projected.length,pinnedRows:8,beforeBytes:before,projectedBytes:projection,afterBytes:after,mediaSigningCalls:0}));
  const explain=await ChatRoom.aggregate(pinnedPipeline('alice_bob','bob')).explain('executionStats');assert.match(JSON.stringify(explain),/IXSCAN/);
  backend=await startBackend(uri);
  const http=await request(backend,'bob','/chat/rooms/alice_bob/pinned');assert.equal(http.messages.length,8);
  assert.equal(http.messages[0].url,'chat/video.mp4','pin previews require no Stream or R2 network work');
  await request(backend,'carol','/chat/rooms/alice_bob/pinned',{status:403});
  await Match.deleteMany({});await request(backend,'bob','/chat/rooms/alice_bob/pinned',{status:409});
});
