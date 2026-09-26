const {test}=require("node:test"),assert=require("node:assert/strict"),mongoose=require("mongoose");
const {MongoMemoryServer}=require("mongodb-memory-server");
const User=require("../models/User"),Match=require("../models/Match"),ChatRoom=require("../models/ChatRoom");
const {startBackend,stopBackend,request}=require("./integrationHelpers");
const {legacyFixture}=require("./fixtures");
test("thread paging retains all visible history and mark-read retains the room",{timeout:180000},async(t)=>{
  const mongo=await MongoMemoryServer.create({instance:{ip:"127.0.0.1"}});let backend;
  t.after(async()=>{if(backend)await stopBackend(backend);await mongoose.disconnect();await mongo.stop();});
  const uri=mongo.getUri("chat_thread_fixture");await mongoose.connect(uri,{autoIndex:false});
  const fixture=legacyFixture();await User.insertMany(fixture.users);await Match.insertMany(fixture.matches);
  const messages=Array.from({length:167},(_,i)=>({id:`m${i}`,from:"alice",to:"bob",text:"x".repeat(3000),time:new Date(1700000000000+i*1000),hiddenFor:i===20?["bob"]:[]}));
  await ChatRoom.create({roomId:"alice_bob",participants:["alice","bob"],messages});
  backend=await startBackend(uri);
  let page=await request(backend,"bob","/chat/rooms/alice_bob?limit=40"),ids=[];
  assert.equal(page.messages.length,40);assert.equal(page.messages.at(-1).id,"m166");
  for(let n=0;n<10;n++){
    ids=[...page.messages.map(m=>m.id),...ids];if(!page.hasMore)break;
    page=await request(backend,"bob",`/chat/rooms/alice_bob?limit=40&before=${page.nextCursor}`);
  }
  assert.equal(new Set(ids).size,166);assert.equal(ids.length,166);assert.equal(ids[0],"m0");assert.ok(!ids.includes("m20"));
  const legacy=await request(backend,"bob","/chat/rooms/alice_bob");assert.equal(legacy.length,166);
  const invalid=await request(backend,"bob","/chat/rooms/alice_bob?limit=40&before=missing");assert.equal(invalid.cursorInvalid,true);
  const marked=await request(backend,"bob","/chat/mark-read",{method:"POST",body:{peerId:"alice"}});
  assert.equal(marked.ok,true);assert.equal(marked.summary.total,0);
  const stored=await ChatRoom.findOne({roomId:"alice_bob"}).lean();assert.equal(stored.messages.length,167);assert.ok(stored.lastReadAtByUser.bob);
  await request(backend,"carol","/chat/rooms/alice_bob?limit=40",{status:403});
});
