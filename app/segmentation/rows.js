const half=value=>Number.isFinite(value)&&Number.isInteger(value*2);
export function validateRow(row,width,height) {
  if(!row||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return false;
  const left=row.left??0,right=row.right??width;
  return [row.top,row.bottom,left,right].every(Number.isFinite)&&row.top>=0&&row.bottom<=height&&row.bottom>row.top&&left>=0&&right<=width&&right>left&&half(row.modules)&&row.modules>0&&row.modules<=100&&Array.isArray(row.cuts)&&row.cuts.length>=2&&row.cuts[0]===0&&row.cuts.at(-1)===row.modules&&row.cuts.every((c,i)=>half(c)&&c>=0&&c<=row.modules&&(i===0||c>row.cuts[i-1]));
}
export function deviceRects(row,width) {
  if(!validateRow(row,width,row?.bottom))throw Error('La rangée ou ses séparations sont invalides.');
  const left=row.left??0,ppm=((row.right??width)-left)/row.modules;
  return row.cuts.slice(0,-1).map((start,i)=>({x:left+start*ppm,y:row.top,width:(row.cuts[i+1]-start)*ppm,height:row.bottom-row.top,modules:row.cuts[i+1]-start}));
}
function percentile(values,fraction){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*fraction)]??0;}
// Aide par contraste, sans reconnaissance de rail physique ni d'appareil.
export function suggestRows(image) {
  const {width,height,data}=image??{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<24||height<24||!data||data.length<width*height*4)return [];
  const stepX=Math.max(1,Math.ceil(width/640)),stepY=Math.max(1,Math.ceil(height/1024)),scores=[];
  for(let y=0;y<height;y+=stepY){
    let sum=0,squared=0,edges=0,previous,count=0;
    for(let x=Math.floor(width*.05);x<Math.ceil(width*.95);x+=stepX){const p=(y*width+x)*4,alpha=data[p+3]/255,v=(.2126*data[p]+.7152*data[p+1]+.0722*data[p+2])*alpha+255*(1-alpha);sum+=v;squared+=v*v;if(previous!==undefined)edges+=Math.abs(v-previous);previous=v;count++;}
    scores.push(Math.sqrt(Math.max(0,squared/count-(sum/count)**2))+2*edges/Math.max(1,count-1));
  }
  const baseline=percentile(scores,.2),peak=Math.max(...scores);
  if(peak<10||peak-baseline<6)return [];
  const threshold=baseline+Math.max(4,(peak-baseline)*.09),active=scores.map(s=>s>threshold),gap=Math.max(2,Math.round(height*.035/stepY));
  let previous=-1;
  for(let i=0;i<active.length;i++){if(!active[i])continue;if(previous>=0&&i-previous-1<=gap)for(let j=previous+1;j<i;j++)active[j]=true;previous=i;}
  const rows=[],minimum=Math.max(12,height*.025),padding=Math.max(1,Math.round(height*.004));let start=-1;
  for(let i=0;i<=active.length;i++){if(active[i]&&start===-1)start=i;if(!active[i]&&start!==-1){const top=Math.max(0,start*stepY-padding),bottom=Math.min(height,i*stepY+padding);if(bottom-top>=minimum)rows.push({top,bottom,left:0,right:width,modules:13,cuts:Array.from({length:14},(_,n)=>n)});start=-1;}}
  return rows;
}
