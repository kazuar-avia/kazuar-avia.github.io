/* Compact map labels: all labels remain visible. No collision hiding. */
(function(root){
'use strict';
function labelScale(zoom){return zoom<=5?0.80:zoom<=6?0.85:zoom<=7?0.90:1;}
function attach(map){
 if(!map||map._kazuarLabelsAttached)return;
 map._kazuarLabelsAttached=true;
 const el=map.getContainer();
 function update(){el.style.setProperty('--kazuar-label-scale',String(labelScale(map.getZoom())));}
 map.on('zoomend',update);
 map.once('unload',()=>{map.off('zoomend',update);el.style.removeProperty('--kazuar-label-scale');delete map._kazuarLabelsAttached;});
 update();
}
const api={labelScale,attach};root.KazuarMapLabels=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
