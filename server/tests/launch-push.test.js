const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {createRequire}=require("node:module");
const {createExpoPushTransport}=require("../services/expoPushTransport");
function load(file,mocks={},fetchImpl){const filename=path.resolve(__dirname,"..",file),module={exports:{}};const req=createRequire(filename);
 vm.runInThisContext("(function(require,module,exports,fetch){"+fs.readFileSync(filename,"utf8")+"\n})",{filename})(name=>mocks[name]||req(name),module,module.exports,fetchImpl);return module.exports;}

test("push batches at 100, counts only accepted tickets, saves receipts and prunes invalid devices",async()=>{
 const batches=[],saved=[],pruned=[],codes=[];
 const send=createExpoPushTransport({fetchImpl:async(_,options)=>{const batch=JSON.parse(options.body);batches.push(batch);return{ok:true,json:async()=>({data:batch.map((m,i)=>i===0?{status:"error",details:{error:"DeviceNotRegistered"}}:{status:"ok",id:m.to})})};},saveReceipt:async(id,token)=>saved.push([id,token]),prune:async tokens=>pruned.push(...tokens),report:code=>codes.push(code)});
 const result=await send(Array.from({length:102},(_,i)=>({to:"ExpoPushToken["+i+"]",body:"private content"})).concat({to:"invalid"}));
 assert.deepEqual(batches.map(b=>b.length),[100,2]);assert.equal(result.sentCount,100);assert.equal(saved.length,100);assert.equal(pruned.length,2);assert.equal(result.ok,false);
 assert.deepEqual(codes,["DeviceNotRegistered","DeviceNotRegistered"]);
});

test("receipt persistence failures do not skip later tickets; credentials and malformed tickets are reported",async()=>{
 const saved=[],codes=[];const send=createExpoPushTransport({fetchImpl:async()=>({ok:true,json:async()=>({data:[{status:"ok",id:"first"},{status:"ok",id:"second"},{status:"error",details:{error:"InvalidCredentials"}}]})}),saveReceipt:async id=>{if(id==="first")throw Error("disk");saved.push(id);},prune:async()=>{},report:c=>codes.push(c)});
 const result=await send(Array.from({length:4},(_,i)=>({to:"ExpoPushToken["+i+"]"})));
 assert.equal(result.sent,2);assert.deepEqual(saved,["second"]);assert.deepEqual(codes,["ReceiptPersistenceFailed","InvalidCredentials","MissingPushTicket"]);
});

test("durable receipt checker prunes rejected devices, removes processed records, retries missing receipts",async()=>{
 const removed=[],updates=[],pruned=[];const rows=[{ticketId:"accepted",token:"a"},{ticketId:"invalid",token:"b"},{ticketId:"missing",token:"c",expiresAt:new Date(Date.now()+86400000)}];
 const receipt={find:()=>({limit:()=>({lean:async()=>rows})}),deleteOne:async x=>removed.push(x.ticketId),updateOne:async(...args)=>updates.push(args)};
 const checker=load("services/expoPushReceipts.js",{"../models/ExpoPushReceipt":receipt,"../models/User":{updateMany:async(...args)=>pruned.push(args)}},async(_,options)=>{
 assert.deepEqual(JSON.parse(options.body).ids,["accepted","invalid","missing"]);return{ok:true,json:async()=>({data:{accepted:{status:"ok"},invalid:{status:"error",details:{error:"DeviceNotRegistered"}}}})};});
 await checker.checkPushReceipts();assert.deepEqual(removed,["accepted","invalid"]);assert.equal(pruned.length,2);assert.equal(updates[0][0].ticketId,"missing");assert.ok(updates[0][1].$set.nextCheckAt>Date.now());
 await checker.saveReceipt("new","token");assert.equal(updates[1][2].upsert,true);assert.ok(updates[1][1].$setOnInsert.expiresAt>Date.now());
});

test("chat/match/call dispatch respects master and category switches and carries recipient-owned deep links",async()=>{
 const sent=[];let recipient={id:"B",settings:{notifications:{push:true,messages:false,buzz:false}},pushTokens:[{token:"ExpoPushToken[test]"}]};
 const query=value=>({select:()=>({lean:async()=>value})});
 const helpers=load("utils/helpers.js",{"../models/User":{findOne:({id})=>query(id==="B"?recipient:{id:"A",firstName:"A"})},"../services/expoPushService":{sendExpoPushMessages:async messages=>{sent.push(...messages);return{invalidTokens:[]};}}});
 const message={id:"m",from:"A",to:"B",text:"hello"};
 await helpers.sendChatMessagePush({message,sender:{id:"A"},recipient});await helpers.sendNotificationPush({id:"n",toId:"B",type:"match",fromId:"A"});assert.equal(sent.length,0);
 recipient.settings.notifications={push:false,messages:true,buzz:true};await helpers.sendChatMessagePush({message,sender:{id:"A"},recipient});assert.equal(sent.length,0);
 recipient.settings.notifications={push:true,messages:true,buzz:true};await helpers.sendChatMessagePush({message,sender:{id:"A"},recipient});await helpers.sendNotificationPush({id:"n",toId:"B",type:"match",fromId:"A"});
 assert.equal(sent.length, 2);
 assert.equal(sent[0].data.recipientId, "B");
 assert.equal(sent[0].data.peerId, "A");
 assert.equal(sent[1].data.recipientId, "B");
 assert.equal(sent[0].channelId, "rombuzz-messages-v1");
 assert.equal(sent[0].sound, "alert.wav");
 assert.equal(sent[1].channelId, "default");
 assert.equal(sent[1].sound, "default");

 const calls=[];const service=load("services/expoPushService.js",{"./expoPushReceipts":{saveReceipt:async()=>{},prune:async()=>{},report:()=>{}},"./expoPushTransport":{createExpoPushTransport:()=>async messages=>calls.push(...messages)}});
 await service.sendIncomingVideoCallPush({receiver:{...recipient,settings:{notifications:{messages:false}}},call:{id:"call"}});assert.equal(calls.length,0);
 await service.sendIncomingVideoCallPush({receiver:recipient,call:{id:"call",callerId:"A",receiverId:"B"}});assert.equal(calls[0].data.recipientId,"B");
});

test("persisted-chat dispatcher skips muted and deleted recipients",async()=>{
 let recipient={id:"B"},muted=true;const calls=[];const query=value=>({select:()=>({lean:async()=>value})});
 const service=load("services/chatPushNotification.js",{"../models/User":{findOne:({id})=>query(id==="A"?{id:"A"}:recipient)},"../models/ChatRoom":{findOne:()=>query({chatPrefsByUser:{B:{muted}}})},"../utils/helpers":{sendChatMessagePush:async args=>calls.push(args)}});
 const message={id:"m",from:"A",to:"B",text:"hello"};await service.sendPersistedChatPush(message,"A_B");assert.equal(calls.length,0);
 muted=false;recipient={id:"B",deleteStatus:"pending_delete"};await service.sendPersistedChatPush(message,"A_B");assert.equal(calls.length,0);
 recipient={id:"B"};await service.sendPersistedChatPush(message,"A_B");assert.equal(calls.length,1);
});
