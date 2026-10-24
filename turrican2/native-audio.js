// Browser lifecycle only; game logic never depends on audio availability.
// NATIVE_WORKLET_URL: the presentation page builds the worklet from its
// opened (sealed) sound files as a Blob URL.
'use strict';
const NativeAudio=(()=>{
    class Output {
        constructor(status){this.status=status;this.context=null;this.node=null;this.bank=null;this.loading=null;this.paused=true;this.gain=0.5;this.blastGain=1;this.enabled=true;this.music=true;this.failed=false;this.song=0;}
        setSong(song){if(song===this.song)return;this.song=song;this.message({song});}
        message(data){if(this.node)this.node.port.postMessage(data);}
        load(main,level,music,header=null){this.bank={main,level,music,header};this.failed=false;this.message({bank:this.bank,song:this.song,reset:true});if(this.node)this.readyStatus();}
        readyStatus(){if(!this.failed)this.status.textContent=this.bank?.header!=null?'Původní hudba úvodu':'Původní hudba aktuální podúrovně a zvukové efekty · čtyři sdílené kanály';}
        clear(){this.bank=null;this.paused=true;this.message({reset:true,paused:true});}
        reset(){this.message({reset:true});}
        volume(value){this.gain=value;this.message({gain:value});}
        setBlastGain(value){this.blastGain=value;this.message({blastGain:value});}
        mute(enabled){this.enabled=enabled;this.message({effects:enabled});}
        setMusic(enabled){this.music=enabled;this.message({music:enabled});}
        pause(value){if(value!==this.paused){this.paused=value;this.message({paused:value});}}
        events(events){if(!this.failed)this.message({events});}
        async unlock(){
            try{
                if(!this.context){
                    const AC=window.AudioContext||window.webkitAudioContext;
                    if(!AC)throw Error('Prohlížeč nepodporuje Web Audio');
                    this.context=new AC({latencyHint:'interactive'});
                }
                // Must resume inside the original click/key gesture, before loading modules.
                const resumed=this.context.resume();
                if(!this.loading)this.loading=(async()=>{
                    if(!this.context.audioWorklet)throw Error('Zvuk vyžaduje HTTPS nebo localhost');
                    await this.context.audioWorklet.addModule(globalThis.NATIVE_WORKLET_URL||'native-sound-worklet.js?v=c66a5848');
                    this.node=new AudioWorkletNode(this.context,'turrican-sound',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
                    this.node.port.onmessage=({data})=>{if(data.error){this.failed=true;this.status.textContent='Zvuk: '+data.error;}};
                    // Mild reconstruction filter; analog Amiga filter parity is not claimed.
                    const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=7000;filter.Q.value=0.707;
                    this.node.connect(filter).connect(this.context.destination);
                    this.message({bank:this.bank,song:this.song,paused:this.paused,gain:this.gain,blastGain:this.blastGain,music:this.music,effects:this.enabled});
                })();
                await Promise.all([resumed,this.loading]);
                this.readyStatus();
            }catch(e){this.status.textContent='Zvuk není dostupný: '+e.message;}
        }
    }
    return{Output};
})();
