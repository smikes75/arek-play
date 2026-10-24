// Gamepad presentation adapter. Keyboard and controller are combined at the
// logic boundary; disconnecting one source never clears the other.
'use strict';
const NativeInput=(()=>{
    const empty=()=>({left:false,right:false,jump:false,down:false,fire:false,space:false,special:false});
    const button=(pad,n)=>{const b=pad.buttons?.[n];return typeof b==='number'?b>.5:!!b&&(b.pressed||b.value>.5);};
    class Gamepads {
        constructor(read=()=>navigator.getGamepads?.()||[]){this.read=read;this.preferred='auto';this.fireButton='auto';this.previous=new Set();this.selected=null;this.pads=[];}
        poll(){
            try{this.pads=Array.from(this.read()).filter(p=>p&&p.connected!==false);}catch{this.pads=[];}
            const pad=this.pads.find(p=>String(p.index)===this.preferred)||(this.preferred==='auto'?this.pads[0]:null);
            const out=empty();let pressed=new Set();
            if(pad){
                const x=pad.axes?.[0]||0,y=pad.axes?.[1]||0;
                const standard=pad.mapping==='standard',fireIndex=/^(?:[0-9]|[1-5][0-9]|6[0-3])$/.test(this.fireButton)?Number(this.fireButton):null;
                // An explicitly bound Fire button cannot also jump, invoke
                // Space/special, pause or change weapons.
                const other=n=>n!==fireIndex&&button(pad,n);
                Object.assign(out,{left:x<-.4||(standard&&other(14)),right:x>.4||(standard&&other(15)),
                    jump:y<-.4||(standard&&(other(12)||other(0))),down:y>.4||(standard&&other(13)),
                    fire:fireIndex!==null?button(pad,fireIndex):standard?button(pad,2)||button(pad,7):[0,1,2,3,7].some(n=>button(pad,n)),
                    space:standard&&other(1),special:standard&&other(3)});
                // Unmapped USB joysticks have no A/B/X/Y contract: their
                // primary buttons fire; jumping uses up, as on the Amiga.
                // Common DirectInput hat encoding, only for nonstandard pads.
                const hat=pad.mapping!=='standard'?pad.axes?.[9]:undefined;
                if(Number.isFinite(hat)&&hat>=-1&&hat<=1){
                    const h=Math.round((hat+1)*3.5);
                    out.jump||=[0,1,7].includes(h);out.right||=[1,2,3].includes(h);out.down||=[3,4,5].includes(h);out.left||=[5,6,7].includes(h);
                }
                for(const [key,active] of [['fire',out.fire],['pause',other(9)],['previous',other(4)],['next',other(5)]])if(active)pressed.add(key);
            }
            const changed=this.selected!==pad?.index;
            const edge=key=>pressed.has(key)&&(!this.previous.has(key)||changed);
            out.firePressed=edge('fire');out.pausePressed=edge('pause');out.weaponStep=edge('next')?1:edge('previous')?-1:0;
            this.previous=pressed;this.selected=pad?.index??null;return out;
        }
    }
    function combine(keys,pad=empty()){
        return{left:keys.has('ArrowLeft')||pad.left,right:keys.has('ArrowRight')||pad.right,jump:keys.has('ArrowUp')||pad.jump,
            down:keys.has('ArrowDown')||pad.down,space:keys.has('Space')||pad.space,
            fire:keys.has('KeyZ')||keys.has('ControlLeft')||keys.has('ControlRight')||pad.fire,special:keys.has('KeyX')||keys.has('Space')||pad.space||pad.special};
    }
    return{Gamepads,combine};
})();
if(typeof module!=='undefined')module.exports=NativeInput;
