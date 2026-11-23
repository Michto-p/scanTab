// Proposition géométrique locale : les 18 mm ne suffisent pas à donner une
// échelle en pixels. Il faut aussi des séparations répétées visibles.
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const clamp = value => Math.max(0, Math.min(1, value));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
};

function grayImage(image) {
  const { width, height, data } = image ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || !data || data.length !== width * height * 4) return null;
  // Le calcul travaille sur un aperçu ; les coordonnées retournent à la
  // résolution originale et les vignettes restent découpées dans l'original.
  const factor = Math.max(1, Math.max(width, height) / 1100);
  const w = Math.round(width / factor), h = Math.round(height / factor);
  const pixels = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const source = (Math.min(height - 1, Math.floor((y + .5) * height / h)) * width + Math.min(width - 1, Math.floor((x + .5) * width / w))) * 4;
    const alpha = data[source + 3] / 255;
    pixels[y * w + x] = (.2126 * data[source] + .7152 * data[source + 1] + .0722 * data[source + 2]) * alpha + 255 * (1 - alpha);
  }
  return { pixels, width: w, height: h, scaleX: width / w, scaleY: height / h };
}

function rowBands({ pixels, width, height }) {
  const scores = [];
  for (let y = 0; y < height; y++) {
    let sum = 0, square = 0, edges = 0, count = 0;
    const start = Math.floor(width * .025), end = Math.ceil(width * .975);
    for (let x = start; x < end; x++) {
      const value = pixels[y * width + x];
      sum += value; square += value * value; count++;
      if (x > start) edges += Math.min(80, Math.abs(value - pixels[y * width + x - 1]));
    }
    scores.push(Math.sqrt(Math.max(0, square / count - (sum / count) ** 2)) + edges * 3 / count);
  }
  const baseline = percentile(scores, .2), peak = percentile(scores, .97);
  if (peak < 10 || peak - baseline < 7) return [];
  const threshold = baseline + Math.max(5, (peak - baseline) * .13);
  const active = scores.map(value => value > threshold);
  const join = Math.max(3, Math.round(height * .035));
  let previous = -1;
  for (let y = 0; y < active.length; y++) if (active[y]) {
    if (previous >= 0 && y - previous - 1 <= join) for (let middle = previous + 1; middle < y; middle++) active[middle] = true;
    previous = y;
  }
  const bands = []; let start = -1;
  for (let y = 0; y <= active.length; y++) {
    if (active[y] && start < 0) start = y;
    if (!active[y] && start >= 0) {
      if (y - start >= Math.max(24, height * .045)) bands.push({ top: start, bottom: y });
      start = -1;
    }
  }
  return bands;
}

function frontEdges(image, band) {
  const { pixels, width } = image, height = band.bottom - band.top;
  const strengths = new Float32Array(width), persistences = new Float32Array(width);
  // Un marquage ou un levier ne traverse normalement pas toute la façade.
  // Une frontière retenue doit persister sur au moins 52 % de sa hauteur ;
  // un joint peu contrasté ou partiellement caché reste ensuite soumis à la
  // concordance de plusieurs bords sur le pas, contrairement à un levier.
  for (let x = 2; x < width - 2; x++) {
    let persistent = 0, contrast = 0;
    for (let y = band.top + 2; y < band.bottom - 2; y++) {
      const difference = Math.abs(pixels[y * width + x + 1] - pixels[y * width + x - 1]);
      if (difference >= 7) persistent++;
      contrast += Math.min(110, difference);
    }
    const count = Math.max(1, height - 4);
    if (persistent / count >= .52) { strengths[x] = contrast / count; persistences[x] = persistent / count; }
  }
  const maximum = Math.max(...strengths);
  if (maximum < 12) return [];
  const threshold = Math.max(7, maximum * .14), points = [];
  const join = Math.max(2, Math.round(height * .04));
  let cluster = [];
  const flush = () => {
    if (!cluster.length) return;
    let sum = 0, weight = 0;
    for (const x of cluster) { sum += x * strengths[x]; weight += strengths[x]; }
    points.push({ x: sum / weight, strength: weight / cluster.length, persistence: Math.max(...cluster.map(x => persistences[x])) });
    cluster = [];
  };
  for (let x = 2; x < width - 2; x++) if (strengths[x] >= threshold) {
    if (cluster.length && x - cluster.at(-1) > join) flush();
    cluster.push(x);
  }
  flush();
  return points;
}

// Les façades sont proposées avant leur largeur en modules. Un intervalle
// entre deux bords peut être une place vide : il doit aussi posséder un haut
// et un bas distincts du fond, et pas seulement deux traits verticaux.
function visibleFronts(image, band, edges) {
  const { pixels, width, height } = image, span = band.bottom - band.top;
  const inset = Math.max(2, Math.round(span * .035));
  const insideTop = Math.min(band.bottom - 1, band.top + inset);
  const insideBottom = Math.max(band.top, band.bottom - 1 - inset);
  const boundaryContrast = (x, boundary) => {
    let contrast = 0;
    const radius = Math.max(3, Math.round(span * .16));
    // Le bord du plastron peut monter de quelques pixels d'une extrémité à
    // l'autre. Chercher le contraste près du bord, pas à une seule ordonnée.
    for (let y = Math.max(2, boundary - radius); y <= Math.min(height - 3, boundary + radius); y++) contrast = Math.max(contrast, Math.abs(pixels[(y + 2) * width + x] - pixels[(y - 2) * width + x]));
    return contrast;
  };
  const fronts = [];
  for (let index = 1; index < edges.length; index++) {
    const left = edges[index - 1], right = edges[index], extent = right.x - left.x;
    if (extent < Math.max(5, span / 18) || extent > span * 2.3) continue;
    let upper = 0, lower = 0, recessUpper = 0, recessLower = 0, count = 0;
    const margin = Math.max(3, Math.round(Math.min(extent * .12, span * .04)));
    for (let x = Math.ceil(left.x + margin); x < right.x - margin; x += Math.max(1, Math.round(extent / 60))) {
      upper += boundaryContrast(x, band.top);
      lower += boundaryContrast(x, band.bottom);
      let differenceUpper = 0, differenceLower = 0;
      for (let y = Math.floor(band.top + span * .3); y < band.top + span * .7; y += Math.max(1, Math.round(span / 40))) {
        const middle = pixels[y * width + x];
        differenceUpper = Math.max(differenceUpper, Math.abs(middle - pixels[insideTop * width + x]));
        differenceLower = Math.max(differenceLower, Math.abs(middle - pixels[insideBottom * width + x]));
      }
      recessUpper += differenceUpper;
      recessLower += differenceLower;
      count++;
    }
    if (!count) continue;
    const boundary = Math.min(upper, lower) / count;
    // Deux frontières horizontales concordantes sont nécessaires. Un espace
    // sombre, une goulotte et un rail nu restent des intervalles non retenus.
    if (boundary < 12) continue;
    const confidence = Math.min(.9, .74 + Math.min(.12, boundary / 300) + Math.min(.04, Math.min(left.strength, right.strength) / 1500));
    fronts.push({ left, right, confidence, recess: Math.min(recessUpper, recessLower) / count });
  }
  // Une goulotte peut elle-même former le cadre rectangulaire de toute la
  // bande. Si plusieurs façades montrent un intérieur distinct de ce cadre,
  // les seules languettes de cadre aux deux bouts ne sont pas des appareils.
  const nested = fronts.filter(front => front.recess > 24);
  return nested.length >= 2 && nested.length >= fronts.length / 2 ? fronts.filter(front => front.recess > 12) : fronts;
}

function fitGrid(points, height, fronts) {
  if (points.length < 4) return null;
  const candidates = new Set();
  // Le plastron peut cacher les bornes et ne laisser visible qu'une hauteur
  // de 2,5 pas environ. La répétition des vraies façades détermine le pas ;
  // cette borne large écarte seulement les formes géométriques extrêmes.
  const minimum = Math.max(7, height / 6.2), maximum = height / 2.3;
  for (let i = 1; i < points.length; i++) {
    const distance = points[i].x - points[i - 1].x;
    for (let halves = 1; halves <= 12; halves++) {
      const pitch = distance * 2 / halves;
      if (pitch >= minimum && pitch <= maximum) candidates.add(Math.round(pitch * 10) / 10);
    }
  }
  let best = null;
  for (const initialPitch of candidates) for (const origin of points) {
    const matching = points.filter(point => Math.abs((point.x - origin.x) / initialPitch * 2 - Math.round((point.x - origin.x) / initialPitch * 2)) <= .19);
    if (matching.length < 4) continue;
    const first = matching[0].x;
    let indexed = normalizeGrid(matching.map(point => ({ ...point, module: Math.round((point.x - first) / initialPitch * 2) / 2 })));
    let fitted = regressGrid(indexed);
    if (!fitted) continue;
    // Le centre d'un joint de quelques pixels se décale au bord d'un fond
    // sombre. Une seconde passe récupère ce bord après ajustement du pas.
    indexed = normalizeGrid(points.map(point => ({ ...point, module: Math.round((point.x - fitted.intercept) / fitted.pitch * 2) / 2 })).filter(point => Math.abs(point.x - fitted.intercept - fitted.pitch * point.module) / fitted.pitch <= .12));
    fitted = regressGrid(indexed);
    if (!fitted) continue;
    const { pitch, intercept } = fitted;
    if (pitch < minimum || pitch > maximum) continue;
    const errors = indexed.map(point => Math.abs(point.x - intercept - pitch * point.module) / pitch);
    if (Math.max(...errors) > .14) continue;
    let single = 0, half = 0, invalid = false;
    for (let i = 1; i < indexed.length; i++) {
      const interval = indexed[i].module - indexed[i - 1].module;
      const physicalFront = fronts.some(front => Math.abs(front.left.x - indexed[i - 1].x) < .5 && Math.abs(front.right.x - indexed[i].x) < .5);
      const persistentFront = Math.min(indexed[i - 1].persistence, indexed[i].persistence) >= .7;
      if (interval <= 0 || (physicalFront && interval > 6)) invalid = true;
      if (physicalFront && persistentFront && interval === 1) single++;
      if (physicalFront && persistentFront && interval === .5) half++;
    }
    const modules = indexed.at(-1).module;
    if (invalid || modules < 3 || modules > 54) continue;
    const alignment = 1 - median(errors) * 5;
    const support = indexed.length / points.length;
    // Des séparations à un module doivent réellement être observées : on
    // n'invente pas un appareil par module dans un différentiel de 2 ou 4.
    const anchor = Math.min(1, single / 3);
    const score = alignment * .4 + support * .25 + anchor * .3 + Math.min(.05, half * .01);
    if (!best || score > best.score) best = { pitch, intercept, indexed, score, single, alignment, support, modules };
  }
  return best;
}

function normalizeGrid(points) {
  if (!points.length) return points;
  // Une prise de 2,5 modules peut être le seul bord de demi-module en bout
  // de rangée. Les espaces ont déjà été écartés d'après les pixels ; ne pas
  // supprimer ce bord au seul motif qu'il n'est pas sur un module entier.
  const origin = points[0]?.module ?? 0;
  return points.map(point => ({ ...point, module: point.module - origin }));
}

function regressGrid(points) {
  if (points.length < 4) return null;
  const meanX = points.reduce((sum, point) => sum + point.module, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  let numerator = 0, denominator = 0;
  for (const point of points) { numerator += (point.module - meanX) * (point.x - meanY); denominator += (point.module - meanX) ** 2; }
  if (!denominator) return null;
  const pitch = numerator / denominator;
  return { pitch, intercept: meanY - pitch * meanX };
}

function alignedFronts(fronts, grid, origin = fronts[0].left.x) {
  if (!grid) return fronts;
  const edges = [fronts[0].left, ...fronts.map(front => front.right)];
  let bestScore = -1;
  for (const proposed of [origin, grid.intercept, ...edges.filter(edge => edge.persistence >= .72).map(edge => edge.x)]) {
    const score = edges.reduce((sum, edge) => {
      const position = (edge.x - proposed) / grid.pitch * 2;
      return sum + (Math.abs(position - Math.round(position)) <= .24 ? edge.persistence ** 2 : 0);
    }, 0);
    if (score > bestScore) { bestScore = score; origin = proposed; }
  }
  const matching = edges.filter((edge, index) => {
    const position = (edge.x - origin) / grid.pitch * 2, aligned = Math.abs(position - Math.round(position)) <= .24;
    const halfBoundary = Math.abs(Math.round(position) % 2) === 1;
    // Une vraie séparation au demi-module traverse la façade. Une hampe
    // imprimée ou un détail du levier ne doit pas diviser un disjoncteur.
    return aligned && (!halfBoundary || edge.persistence >= .72 || index === 0 || index === edges.length - 1);
  });
  if (matching.length < 2) return fronts;
  const aligned = [];
  for (let index = 1; index < matching.length; index++) {
    const left = matching[index - 1], right = matching[index];
    const enclosed = fronts.filter(front => front.left.x >= left.x - .5 && front.right.x <= right.x + .5);
    if (!enclosed.length || (right.x - left.x) / grid.pitch > 6.15) continue;
    // Les bords parasites hors du pas, par exemple une lettre imprimée,
    // ne doivent pas bloquer la lecture de tout le groupe ni le subdiviser.
    aligned.push({ left, right, fittedLeft: origin + Math.round((left.x - origin) / grid.pitch * 2) / 2 * grid.pitch, confidence: Math.min(...enclosed.map(front => front.confidence)) });
  }
  return aligned.length ? aligned : fronts;
}

function analyzeProjection(image, imageData) {
  const rows = [], candidates = [], warnings = [];
  let bandIndex = -1;
  for (const band of rowBands(image)) {
    bandIndex++;
    const edges = frontEdges(image, band), fronts = visibleFronts(image, band, edges);
    const groups = []; let group = [];
    for (const front of fronts) {
      if (group.length && group.at(-1).right !== front.left) { groups.push(group); group = []; }
      group.push(front);
    }
    if (group.length) groups.push(group);
    const facadeEdges = edges.filter(edge => fronts.some(front => front.left === edge || front.right === edge));
    const reliable = grid => grid && grid.single >= 2 && grid.score >= .78 ? grid : null;
    const localGrids = groups.map(groupFronts => reliable(fitGrid([groupFronts[0].left, ...groupFronts.map(front => front.right)], band.bottom - band.top, groupFronts)));
    const proposals = [reliable(fitGrid(facadeEdges, band.bottom - band.top, fronts)), ...localGrids].filter(Boolean).sort((a, b) => b.score - a.score);
    const sharedGrid = proposals[0] ?? null;
    const consistent = !sharedGrid || localGrids.filter(Boolean).every(grid => Math.abs(grid.pitch - sharedGrid.pitch) / sharedGrid.pitch < .12);
    if (!sharedGrid) warnings.push('Une bande est visible, mais ses séparations ne permettent pas de déduire sûrement le pas de 18 mm.');
    if (!consistent) warnings.push('Des groupes présentent des échelles incompatibles ; les groupes sans repère gardent une largeur inconnue.');
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const groupId = `bande-${bandIndex}-groupe-${groupIndex}`;
      const grid = localGrids[groupIndex] ?? (consistent ? sharedGrid : null);
      const originalFronts = groups[groupIndex], stableEdge = [originalFronts[0].left, ...originalFronts.map(front => front.right)].find(edge => edge.persistence >= .72);
      const groupFronts = alignedFronts(originalFronts, grid, localGrids[groupIndex]?.intercept ?? stableEdge?.x ?? originalFronts[0].left.x);
      // Garder la phase ajustée par tous les bords. Reprendre le premier bord
      // brut cumulerait son erreur avec celle des suivants et pourrait faire
      // rejeter toute une rangée malgré des séparations cohérentes.
      const origin = groupFronts[0].fittedLeft ?? groupFronts[0].left.x;
      // Un espace entre deux groupes n'a pas nécessairement une largeur DIN.
      // Le pas peut être partagé, jamais l'origine de la grille à travers ce vide.
      const moduleSpan = grid ? Math.round((groupFronts.at(-1).right.x - origin) / grid.pitch * 2) / 2 : 0;
      const calibrated = grid && (origin + moduleSpan * grid.pitch) * image.scaleX <= imageData.width && groupFronts.every(front => [front.left, front.right].every(edge => Math.abs((edge.x - origin) / grid.pitch * 2 - Math.round((edge.x - origin) / grid.pitch * 2)) <= .24));
      const confidence = calibrated ? Math.min(.94, clamp(grid.score)) : 0;
      const scale = calibrated ? { moduleMillimeters: 18, pixelsPerModule: grid.pitch * image.scaleX, pixelsPerMillimeter: grid.pitch * image.scaleX / 18, confidence, source: 'separations-visibles' } : null;
      const rowIndex = calibrated ? rows.length : null;
      if (calibrated) {
        const stop = moduleSpan;
        const left = origin * image.scaleX;
        const right = (origin + stop * grid.pitch) * image.scaleX;
        if (left >= 0 && right <= imageData.width) rows.push({
          top: band.top * image.scaleY, bottom: band.bottom * image.scaleY,
          left, right, modules: stop,
          cuts: [0, ...groupFronts.map(front => Math.round((front.right.x - origin) / grid.pitch * 2) / 2)],
          confidence, scale, groupId
        });
      }
      for (const front of groupFronts) {
        const modules = calibrated ? Math.round((front.right.x - front.left.x) / grid.pitch * 2) / 2 : null;
        const left = calibrated ? origin + Math.round((front.left.x - origin) / grid.pitch * 2) / 2 * grid.pitch : front.left.x;
        const right = calibrated ? left + modules * grid.pitch : front.right.x;
        if (left < 0 || right * image.scaleX > imageData.width || modules === 0) continue;
        candidates.push({
          left: left * image.scaleX, right: right * image.scaleX,
          top: band.top * image.scaleY, bottom: band.bottom * image.scaleY,
          modules, confiance: front.confidence, confidence: front.confidence, niveau: 'geometrie',
          scale: calibrated ? scale : null, groupId, rowIndex,
          reason: calibrated ? 'Façade visible ; largeur estimée sur les séparations répétées.' : 'Façade visible ; largeur en modules inconnue faute de repère de 18 mm.'
        });
      }
    }
  }
  if (!rows.length && !warnings.length) warnings.push('Aucune rangée modulaire suffisamment lisible. Corriger le cadrage ou tracer les limites manuellement.');
  if (rows.length) warnings.push('Échelle et séparations proposées par géométrie : vérifier les bords et les appareils larges avant validation.');
  return { rows, candidates, warnings };
}

function imageWindow(image, left, width) {
  const pixels = new Float32Array(width * image.height);
  for (let y = 0; y < image.height; y++) pixels.set(image.pixels.subarray(y * image.width + left, y * image.width + left + width), y * width);
  return { ...image, pixels, width };
}

function overlappingArea(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function mergeLocalLayouts(layouts) {
  // Une fenêtre ne fabrique pas de bord à sa limite : seules les façades
  // complètes possédant deux bords observés sont proposées. Les fenêtres
  // voisines peuvent retrouver la même façade ; conserver alors une seule
  // proposition, en privilégiant sa largeur complète et non une subdivision.
  const pool = layouts.flatMap(layout => layout.candidates.filter(candidate => candidate.scale && candidate.modules > 0));
  pool.sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top));
  const distinct = [];
  for (const candidate of pool) {
    const duplicate = distinct.some(existing => overlappingArea(candidate, existing) / Math.min((candidate.right - candidate.left) * (candidate.bottom - candidate.top), (existing.right - existing.left) * (existing.bottom - existing.top)) > .64);
    if (!duplicate) distinct.push(candidate);
  }
  const bands = [];
  for (const candidate of distinct.sort((a, b) => a.top - b.top || a.left - b.left)) {
    let band = bands.find(group => {
      const first = group[0], overlap = Math.max(0, Math.min(first.bottom, candidate.bottom) - Math.max(first.top, candidate.top));
      return overlap / Math.max(first.bottom - first.top, candidate.bottom - candidate.top) > .72 && Math.abs(first.scale.pixelsPerModule - candidate.scale.pixelsPerModule) / first.scale.pixelsPerModule < .12;
    });
    if (!band) { band = []; bands.push(band); }
    band.push(candidate);
  }
  const rows = [], candidates = [];
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const band = bands[bandIndex].sort((a, b) => a.left - b.left), groups = []; let group = [];
    for (const candidate of band) {
      const previous = group.at(-1), pitch = candidate.scale.pixelsPerModule;
      if (previous && Math.abs(candidate.left - previous.right) > pitch * .2) { groups.push(group); group = []; }
      group.push(candidate);
    }
    if (group.length) groups.push(group);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const fronts = groups[groupIndex], left = fronts[0].left, right = fronts.at(-1).right;
      const modules = fronts.reduce((sum, front) => sum + front.modules, 0), pitch = (right - left) / modules;
      if (modules <= 0 || modules > 100 || fronts.some(front => Math.abs((front.right - front.left) / front.modules - pitch) / pitch > .12)) continue;
      const top = median(fronts.map(front => front.top)), bottom = median(fronts.map(front => front.bottom));
      const confidence = Math.min(...fronts.map(front => front.scale.confidence));
      const scale = { moduleMillimeters: 18, pixelsPerModule: pitch, pixelsPerMillimeter: pitch / 18, confidence, source: 'separations-visibles' };
      const cuts = [0], groupId = `local-${bandIndex}-groupe-${groupIndex}`, rowIndex = rows.length;
      for (const front of fronts) cuts.push(cuts.at(-1) + front.modules);
      rows.push({ top, bottom, left, right, modules, cuts, confidence, scale, groupId });
      fronts.forEach((front, index) => candidates.push({ ...front, left: left + cuts[index] * pitch, right: left + cuts[index + 1] * pitch, top, bottom, scale, rowIndex, groupId }));
    }
  }
  return { rows, candidates };
}

export function analyzeLayout(imageData) {
  const image = grayImage(imageData);
  if (!image) return { rows: [], candidates: [], warnings: ['Image trop petite ou invalide pour proposer une échelle.'] };
  const complete = analyzeProjection(image, imageData);
  const incomplete = complete.warnings.some(warning => warning.startsWith('Une bande') || warning.startsWith('Des groupes'));
  const narrow = complete.rows.some(row => (row.right - row.left) / imageData.width < .7);
  if ((complete.rows.length && !incomplete && !narrow) || image.width < 120) return complete;
  // Un coffret ouvert ou un objet voisin très contrasté peut réunir plusieurs
  // rangées dans une seule projection horizontale. Rechercher alors les
  // groupes dans des fenêtres verticales qui se chevauchent, sans coordonnées
  // propres à un modèle de coffret ou à une photographie particulière.
  const width = Math.round(image.width * .6), remaining = image.width - width, local = [];
  for (const left of [0, Math.round(remaining / 2), remaining]) {
    const result = analyzeProjection(imageWindow(image, left, width), { width: width * image.scaleX, height: imageData.height });
    for (const row of result.rows) { row.left += left * image.scaleX; row.right += left * image.scaleX; }
    for (const candidate of result.candidates) { candidate.left += left * image.scaleX; candidate.right += left * image.scaleX; }
    local.push(result);
  }
  const recovered = mergeLocalLayouts([complete, ...local]);
  if (!recovered.rows.length) return complete;
  // Une prise isolée, lisible mais sans étalon de taille, peut attendre l'OCR
  // en dehors des rangées récupérées. Elle reste inconnue et ne disparaît pas.
  const unknown = complete.candidates.filter(candidate => !candidate.scale && !recovered.candidates.some(found => overlappingArea(candidate, found) > 0));
  recovered.candidates.push(...unknown);
  recovered.candidates.sort((a, b) => a.top - b.top || a.left - b.left);
  return { ...recovered, warnings: ['Rangées proposées par recherche locale : vérifier les limites, les appareils larges et les zones non retrouvées.', 'Les autres zones restent inconnues lorsque leurs séparations ne sont pas suffisamment fiables.'] };
}

// Le repère est la largeur mesurée par l'utilisateur sur un appareil dont
// il connaît la largeur d'un module. La calibration n'identifie aucun appareil.
export function calibrateRow(imageData, row, pixelsPerModule) {
  const image = grayImage(imageData);
  if (!image) throw Error('Image invalide pour la calibration de 18 mm.');
  const left = row?.left ?? 0, right = row?.right ?? imageData.width;
  if (!row || ![row.top, row.bottom, left, right].every(Number.isFinite) || row.top < 0 || row.bottom > imageData.height || row.bottom <= row.top || left < 0 || right > imageData.width || right <= left) throw Error('La rangée à calibrer sort de l’image ou ses limites sont invalides.');
  if (!Number.isFinite(pixelsPerModule) || pixelsPerModule < 2 || pixelsPerModule > imageData.width * 2) throw Error('La largeur du repère de 18 mm est invalide.');
  const span = right - left, modules = Math.round(span / pixelsPerModule * 2) / 2;
  if (modules < .5 || modules > 100 || Math.abs(modules * pixelsPerModule - span) / span > .08) throw Error('Le repère de 18 mm est incohérent avec la largeur de la rangée. Vérifier les deux bords choisis.');
  const band = { top: Math.floor(row.top / image.scaleY), bottom: Math.min(image.height, Math.ceil(row.bottom / image.scaleY)) };
  const edges = frontEdges(image, band), cuts = new Set([0, modules]);
  for (const edge of edges) {
    const position = edge.x * image.scaleX;
    const module = Math.round((position - left) / pixelsPerModule * 2) / 2;
    if (module <= 0 || module >= modules) continue;
    if (Math.abs(position - left - module * pixelsPerModule) <= Math.max(2, pixelsPerModule * .12)) cuts.add(module);
  }
  const sortedCuts = [...cuts].sort((a, b) => a - b);
  const confidence = sortedCuts.length > 2 ? .85 : .45;
  return {
    ...row, left, right, modules, cuts: sortedCuts, confidence,
    scale: { moduleMillimeters: 18, pixelsPerModule, pixelsPerMillimeter: pixelsPerModule / 18, confidence: 1, source: 'repere-18-mm' }
  };
}
