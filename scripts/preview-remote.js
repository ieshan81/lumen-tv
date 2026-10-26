'use strict';
// Local-only, synthetic UI fixture. Never controls the desktop or a streaming account.
const { RemoteServer } = require('../src/remote');
const { loadTiles } = require('../src/config');
const { usesTvShell } = require('../src/tv-shell');
const tiles = loadTiles();
const remote = new RemoteServer({host:'127.0.0.1',port:14321,token:'preview'});
let state = {
  t:'state', preview:true, mode:'app', tiles:loadTiles().map(({id,name,accent})=>({id,name,accent})),
  running:{name:'Lumen preview',title:'Playback sample',tileId:'jojo',accent:'#b4a9ff'},
  media:{title:'Playback sample',playing:true,currentTime:92,duration:480,width:1920,height:1080,bufferedSeconds:32,actions:{nextEpisode:true}},
  input:null,navigation:'dpad',projector:{connected:true,label:'Display preview'},audio:{status:'ready',name:'Projector'},sleepAt:null
};
remote.on('connected',ws=>remote.send(ws,state));
remote.on('message',message=>{
  if(message.t==='media'&&message.a==='playpause')state.media.playing=!state.media.playing;
  if(message.t==='key'&&message.k==='Enter')state.input=state.input?null:{fieldId:'preview-field',type:'search',label:'Search your TV'};
  if(message.t==='key'&&message.k==='Back')state.input=null;
  if(message.t==='home'){state.mode='home';state.media=null;state.input=null;}
  if(message.t==='launch'){
    const tile=state.tiles.find(item=>item.id===message.id);
    state.mode='app';state.running={...tile,tileId:tile.id,title:'App preview'};state.media=null;state.input=null;state.focus={label:'Browse titles'};state.navigation=usesTvShell(tiles.find(item=>item.id===tile.id))?'dpad':'touch';
  }
  if(message.t==='text'||message.t==='edit')remote.send([...remote.clients][0],{t:'toast',text:'Preview: text received'});
  remote.broadcast(state);
});
remote.start().then(()=>console.log('Synthetic remote preview: http://127.0.0.1:14321/?t=preview'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{remote.stop();process.exit(0);});
