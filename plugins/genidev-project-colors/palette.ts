export const PALETTE = [
  {name:'Лазурный',hex:'#4F8FF7'}, {name:'Бирюзовый',hex:'#28A99C'},
  {name:'Нефритовый',hex:'#4EAA71'}, {name:'Лаймовый',hex:'#94A844'},
  {name:'Янтарный',hex:'#D59B38'}, {name:'Терракотовый',hex:'#D88157'},
  {name:'Коралловый',hex:'#D86F7E'}, {name:'Розовый',hex:'#C977AB'},
] as const;
export const validColor = (s: string) => /^#[\da-f]{6}$/i.test(s);
export function defaultColor(name: string) {
  const normalized=name.normalize('NFC');
  let n=0;for(const ch of normalized)n=(n*31+ch.charCodeAt(0))>>>0;
  return PALETTE[n%PALETTE.length].hex;
}
export interface ProjectColor {id:string;name:string;color:string|null;chosenAt:number|null}
