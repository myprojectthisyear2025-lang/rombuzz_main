const {test}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const User=require('../models/User'),Relationship=require('../models/Relationship'),Match=require('../models/Match');
const {startBackend,stopBackend,request}=require('./integrationHelpers');
test('projected Discover candidates preserve strict/expanded ranking, hard filters, exclusions and public media',{timeout:180000},async t=>{
  const mongo=await MongoMemoryServer.create({instance:{ip:'127.0.0.1'}});let backend;
  t.after(async()=>{if(backend)await stopBackend(backend);await mongoose.disconnect();await mongo.stop();});
  const uri=mongo.getUri('discover_fixture');await mongoose.connect(uri,{autoIndex:false});
  const make=(id,extra={})=>({id,email:id+'@example.test',firstName:id,gender:'female',lookingFor:'long-term',isVerified:true,visibilityMode:'full',location:{lat:41,lng:-87},dob:'1996-01-01',lastActive:Date.now(),avatar:'https://example.invalid/'+id+'.jpg',media:[{id:'public',url:'https://example.invalid/public.jpg',privacy:'public'},{id:'private',url:'https://example.invalid/private.jpg',privacy:'private'}],...extra});
  await User.insertMany([make('alice',{gender:'male'}),make('strict'),make('relaxed',{lookingFor:'friendship'}),make('male',{gender:'male'}),make('unverified',{isVerified:false}),make('hidden',{visibilityMode:'hidden'}),make('liked'),make('blocked'),make('matched')]);
  await Relationship.create([{id:'l',type:'like',from:'alice',to:'liked'},{id:'b',type:'block',from:'blocked',to:'alice'}]);
  await Match.create({id:'m',status:'matched',users:['alice','matched']});
  await mongoose.connection.db.command({profile:2});
  backend=await startBackend(uri);
  const common='/discover?gender=female&verified=true&lat=41&lng=-87&lookingFor=long-term';
  const strict=await request(backend,'alice',common+'&phase=strict');assert.deepEqual(strict.users.map(u=>u.id),['strict']);
  const relaxed=await request(backend,'alice',common+'&phase=fallback');assert.deepEqual(relaxed.users.map(u=>u.id),['strict','relaxed']);
  for(const u of relaxed.users){assert.equal(u.media.length,1);assert.equal(u.media[0].id,'public');assert.equal(u.distanceMeters,0);assert.equal(u.verified,true);assert.equal(u.gender,'female');}
  const noCoords=await request(backend,'alice','/discover?gender=female&verified=true&lookingFor=long-term');assert.equal(noCoords.users[0].distanceMeters,null);
  const profile=await mongoose.connection.db.collection('system.profile').find({'command.find':'users','command.filter.id.$nin':{$exists:true}}).toArray();
  assert.ok(profile.length>=3);for(const query of profile){assert.equal(query.command.projection.media,1);assert.equal(query.command.projection.location,1);assert.equal(query.command.projection.email,undefined);assert.equal(query.command.limit,400);}
});
