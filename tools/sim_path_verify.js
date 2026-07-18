// Verify programmatic Catmull-Rom seamless path
const cfg = require('../js/define/LevelMapConfig.js');
const SCREEN_WIDTH = 393;
const s = SCREEN_WIDTH / cfg.designWidth;
const k = cfg.roadTargetW / 845 * s;
const btns = cfg.roadButtons;
const roads = cfg.roads;
const N = 47;

function imgDist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }

// Replicate _buildLevels exactly
var r0cap = btns.road_0.length;
var segs = [{rk:'road_0',count:r0cap}];
var rem = N - r0cap, fb = 1;
while(rem>0){
  var rk=(fb%2===1)?'road_1':'road_2';
  var c=Math.min(btns[rk].length,rem);
  if(c<=0)break;
  segs.push({rk:rk,count:c}); rem-=c; fb++;
}
var buildOrder=segs.slice().reverse();
var totalSeg=buildOrder.length;

var built=buildOrder.map(function(e){
  var ri=roads[e.rk];
  var arr=(e.count<btns[e.rk].length)?btns[e.rk].slice(btns[e.rk].length-e.count):btns[e.rk];
  var segW=ri.W*k, roadLeft=(SCREEN_WIDTH-segW)/2;
  var gaps=[];
  for(var i=0;i<e.count-1;i++) gaps.push(imgDist(arr[i],arr[i+1]));
  return {rk:e.rk,count:e.count,ri:ri,arr:arr,segW:segW,roadLeft:roadLeft,
    lastGap:gaps.length?gaps[gaps.length-1]:0,
    firstGap:gaps.length?gaps[0]:0};
});

var segTops=[], segY=0;
for(var bIdx=0;bIdx<built.length;bIdx++){
  if(bIdx>0){
    var prevB=built[bIdx-1], curB=built[bIdx];
    var targetImg=(prevB.lastGap+curB.firstGap)/2;
    var dxWorld=(curB.roadLeft+curB.arr[0].x*k)-(prevB.roadLeft+prevB.arr[prevB.count-1].x*k);
    var dy0World=(prevB.ri.H+curB.arr[0].y-prevB.arr[prevB.count-1].y)*k;
    var targetWorld=targetImg*k;
    var needDy=Math.sqrt(Math.max(0,targetWorld*targetWorld-dxWorld*dxWorld))-dy0World;
    segY+=prevB.ri.H*k+Math.max(0,needDy);
  }
  segTops.push(segY);
}

var levels=[];
for(var si=0;si<built.length;si++){
  var b=built[si];
  for(var bi=0;bi<b.count&&levels.length<N;bi++){
    var bb=b.arr[bi];
    levels.push({x:b.roadLeft+bb.x*k, worldY:segTops[si]+bb.y*k});
  }
}
// Reverse + reindex
levels.reverse();
for(var li=0;li<levels.length;li++) levels[li].index=li;
// Trailing clamp
var TRAIL=cfg.trailBottom||100;
var minY=Math.min.apply(null,levels.map(function(l){return l.worldY;}));
var shiftWorld=TRAIL*s-minY;
for(var j=0;j<levels.length;j++) levels[j].worldY+=shiftWorld;

console.log('Total levels:', levels.length);
console.log('First 5:');
for(var i=0;i<Math.min(5,levels.length);i++)
  console.log('  L'+(i+1)+': x='+levels[i].x.toFixed(1)+' y='+levels[i].worldY.toFixed(1));
console.log('Last 5:');
for(var i=Math.max(0,levels.length-5);i<levels.length;i++)
  console.log('  L'+(i+1)+': x='+levels[i].x.toFixed(1)+' y='+levels[i].worldY.toFixed(1));

// Catmull-Rom
var pts=levels.map(function(l){return{x:l.x,y:l.worldY};});
var n=pts.length;
var stepPx=18*s;
var pathPts=[{x:pts[0].x,y:pts[0].y}];

for(var i=0;i<n-1;i++){
  var p0=pts[Math.max(0,i-1)];
  var p1=pts[i];
  var p2=pts[Math.min(n-1,i+1)];
  var p3=pts[Math.min(n-1,i+2)];
  var dist=Math.hypot(p2.x-p1.x,p2.y-p1.y);
  var steps=Math.max(1,Math.ceil(dist/stepPx));
  for(var st=1;st<=steps;st++){
    var t=st/steps,t2=t*t,t3=t2*t;
    pathPts.push({
      x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
      y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
    });
  }
}

var maxGap=0,totalLen=0;
for(var p=1;p<pathPts.length;p++){
  var g=Math.hypot(pathPts[p].x-pathPts[p-1].x,pathPts[p].y-pathPts[p-1].y);
  maxGap=Math.max(maxGap,g);totalLen+=g;
}
var hasNaN=pathPts.some(function(p){return isNaN(p.x)||isNaN(p.y)||!isFinite(p.x)||!isFinite(p.y);});
console.log('\nCatmull-Rom path:');
console.log('  Points:',pathPts.length,'| Max inter-step:',maxGap.toFixed(1),'px | Total len:',Math.round(totalLen),'px');
console.log('  Has NaN:',hasNaN);

function gapL(a,b){
  if(a>=n||b>=n)return 'N/A';
  return Math.hypot(levels[a].x-levels[b].x,levels[a].worldY-levels[b].worldY).toFixed(1)+'px';
}
console.log('  Level gaps: L10-11='+gapL(9,10)+' L11-12='+gapL(10,11)+
  ' L25-26='+gapL(24,25)+' L26-27='+gapL(25,26)+
  ' L38-L39='+gapL(37,38)+' L39-40='+gapL(38,39));

// Check path passes near each level center
console.log('\nPath vs button alignment (max distance from path):');
var maxDist=0;
for(var li=0;li<levels.length;li++){
  // find closest path point
  var minD=Infinity;
  for(var pi=0;pi<pathPts.length;pi++){
    var dd=Math.hypot(pathPts[pi].x-levels[li].x,pathPts[pi].y-levels[li].worldY);
    if(dd<minD)minD=dd;
  }
  if(minD>maxDist)maxDist=minD;
}
console.log('  Max distance from any level to nearest path point:',maxDist.toFixed(2),'px (should be ~0)');
