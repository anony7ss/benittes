import gsap from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';
export function animateSections(){
 gsap.registerPlugin(ScrollTrigger);
 const ctx=gsap.context(()=>{for(const el of document.querySelectorAll('[data-rise]')){
 gsap.from(el,{y:16,duration:.65,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 94%',once:true}});
 }});
 window.addEventListener('pagehide',()=>ctx.revert(),{once:true});
}
