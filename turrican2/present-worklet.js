// The processor of native-sound-worklet.js without its imports; the page puts the
// opened (sealed) native-sound.js and native-music.js in front of it.
class TurricanSound extends AudioWorkletProcessor {
    constructor(){
        super();this.engine=null;this.paused=true;this.gain=0.5;this.blastGain=1;this.music=true;this.effects=true;
        this.port.onmessage=({data:d})=>{
            try{
                if(d.music!==undefined)this.music=d.music;
                if(d.effects!==undefined)this.effects=d.effects;
                if(d.bank)this.engine=new NativeSound.Engine(new NativeSound.Bank(d.bank.main,d.bank.level,d.bank.music,d.bank.header??null));
                if(d.blastGain!==undefined)this.blastGain=Math.max(1,Math.min(1.5,d.blastGain));
                if(this.engine)this.engine.blastGain=this.blastGain;
                if(d.song!==undefined&&this.engine)this.engine.setSong(d.song);
                if((d.reset||d.bank)&&this.engine){this.engine.reset();this.engine.setMusic(this.music);this.engine.setEffects(this.effects);}
                if(d.music!==undefined&&this.engine)this.engine.setMusic(this.music);
                if(d.effects!==undefined&&this.engine)this.engine.setEffects(this.effects);
                if(d.paused!==undefined)this.paused=d.paused;
                if(d.gain!==undefined)this.gain=Math.max(0,Math.min(1,d.gain));
                if(d.events&&this.engine&&!this.paused)for(const id of d.events)this.engine.request(id);
            }catch(e){this.fail(e);}
        };
    }
    fail(e){this.engine=null;this.port.postMessage({error:String(e.message||e)});}
    process(inputs,outputs){
        const [l,r]=outputs[0];
        if(this.engine&&!this.paused){
            try{this.engine.render(l,r,sampleRate);for(let i=0;i<l.length;i++){l[i]*=this.gain;r[i]*=this.gain;}}
            catch(e){l.fill(0);r.fill(0);this.fail(e);}
        }
        return true;
    }
}
registerProcessor('turrican-sound',TurricanSound);
