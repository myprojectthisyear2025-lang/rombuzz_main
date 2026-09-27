const {test}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Notification=require('../models/Notification');
const {startBackend,stopBackend,request}=require('./integrationHelpers');
const {legacyFixture}=require('./fixtures');
test('compact notifications preserve complete filters/routes/actions; badge count is account scoped',{timeout:180000},async t=>{
  const mongo=await MongoMemoryServer.create({instance:{ip:'127.0.0.1'}});let backend;
  t.after(async()=>{if(backend)await stopBackend(backend);await mongoose.disconnect();await mongo.stop();});
  const uri=mongo.getUri('notifications_fixture');await mongoose.connect(uri,{autoIndex:false});
  const fixture=legacyFixture();await User.insertMany(fixture.users);await Notification.createIndexes();
  const notices=Array.from({length:192},(_,i)=>({id:'n'+i,toId:'bob',fromId:'alice',type:i%2?'comment':'gift',message:'Fixture notification '+i,read:i%3===0,postId:'post-'+i,postOwnerId:'alice',commentId:'c'+i,replyId:'r'+i,createdAt:new Date(1700000000000+i)}));
  await Notification.insertMany([...notices,{id:'private',toId:'carol',fromId:'alice',type:'system',message:'private'}]);
  backend=await startBackend(uri);
  const compact=await request(backend,'bob','/notifications?view=mobile'),legacy=await request(backend,'bob','/notifications');
  assert.equal(compact.notifications.length,192);assert.equal(legacy.notifications.length,192);assert.ok(JSON.stringify(compact).length<JSON.stringify(legacy).length);
  for(let i=0;i<192;i++){
    const a=compact.notifications[i],b=legacy.notifications[i];
    for(const field of ['id','toId','fromId','type','message','read','createdAt','href','targetId','targetOwnerId','targetType','commentId','replyId'])assert.deepEqual(a[field],b[field]);
    assert.equal(a.fromUser,undefined);assert.equal(b.fromUser.id,'alice');
  }
  assert.deepEqual(await request(backend,'bob','/notifications/unread-count'),{total:128});
  await request(backend,'bob','/notifications/n1/read',{method:'PATCH'});assert.equal((await request(backend,'bob','/notifications/unread-count')).total,127);
  await request(backend,'bob','/notifications/n1/unread',{method:'PATCH'});await request(backend,'bob','/notifications/n1',{method:'DELETE'});
  assert.equal((await request(backend,'bob','/notifications/unread-count')).total,127);
  await request(backend,'carol','/notifications/n2/read',{method:'PATCH',status:404});
  assert.equal((await request(backend,'carol','/notifications/unread-count')).total,1);
  const explain=await Notification.find({toId:'bob',read:{$ne:true}}).explain('executionStats');assert.match(JSON.stringify(explain),/IXSCAN/);
});
