import {FAMILIES,visibleFieldsForFamily,incompatibleFieldsForFamily} from './labels.js';
import {reviewRecognitionDimensions} from '../identification/formats.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>String(value).replace('.',',');

export function workspaceMarkup({group,validator,automaticAfterPhoto}){
  return `<div class="workspace-heading"><div><h1>Scanner un tableau</h1><p id="summary"></p></div><details class="collection-menu"><summary>Mes photos et options</summary><div class="collection-options">
    <div class="photo-library"><label for="saved-photos">Photos enregistrées<select id="saved-photos"><option value="">Choisir une photo</option></select></label><button data-action="open">Ouvrir</button><button data-action="delete" class="danger">Supprimer</button></div>
    <button id="export" data-action="export" disabled>Exporter les appareils validés en ZIP</button>
    <details id="session-details"><summary>Séance et validation</summary><section class="session-bar"><label>Nom du tableau<input id="session-name" value="Tableau électrique" maxlength="100"></label><label>Séance photo<input id="group-id" value="${escape(group)}" maxlength="100"></label><label>Votre nom ou vos initiales<input id="validator" value="${escape(validator)}" maxlength="100" autocomplete="name"></label><button data-action="new-group">Nouvelle séance</button></section></details>
    <label class="automatic-option"><input type="checkbox" id="auto-after-photo" ${automaticAfterPhoto?'checked':''}>Cadrer et repérer après la photo</label>
    <details class="fine-settings"><summary>Corrections avancées</summary><nav id="steps" class="steps" aria-label="Corrections de la photo"></nav></details>
    <span id="save-status" role="status">Les photos restent sur cet appareil</span>
  </div></details></div>
  <p id="message" role="status" aria-live="polite">Prenez une photo nette du tableau.</p>
  <div class="photo-actions" id="photo-actions" hidden><button data-action="camera">Nouvelle photo</button><button data-action="import">Importer</button><button data-step="perspective">Corriger le cadrage</button></div>
  <div class="workbench"><div class="photo-column"><div class="stage"><div id="empty-photo"><img src="./icons/tableau.svg" width="64" height="64" alt=""><h2>Votre tableau en photo</h2><p>Cadrez les appareils de face, avec leurs inscriptions lisibles.</p><div class="stack"><button class="primary" data-action="camera">Prendre une photo</button><button data-action="import">Importer des photos</button></div></div><canvas id="photo-canvas" hidden aria-label="Photo du tableau : touchez un appareil ou encadrez une rangée."></canvas></div><p id="photo-info" class="hint"></p><div id="thumbnails" class="thumbnails" aria-label="Appareils découpés" hidden></div></div><aside id="tools" aria-label="Sélection et lecture" hidden></aside></div>
  <input type="file" id="import-file" accept="image/*" multiple hidden><input type="file" id="camera-file" accept="image/*" capture="environment" hidden>`;
}

export function selectionMarkup(session,{drawing=false}={}){
  const chosen=session.chosenCandidates??[],area=session.selection,modules=area?.modules??'',count=chosen.length;
  return `<h2>Quels appareils lire ?</h2><p class="hint">Touchez les appareils sur la photo ou encadrez une rangée.</p>
    <div class="selection-actions"><button data-action="draw-selection" aria-pressed="${drawing}">${drawing?'Annuler le tracé':'Encadrer une rangée'}</button><button data-action="select-all">${count===(session.candidates?.length??0)&&count?'Tout désélectionner':'Tout sélectionner'}</button></div>
    ${session.rows.length?`<div class="row-shortcuts" aria-label="Choisir une rangée">${session.rows.map((row,index)=>`<button data-select-row="${index}" aria-pressed="${area?.rowIndex===index}">Rangée ${index+1}</button>`).join('')}</div>`:''}
    ${area?`<label class="module-entry">Modules dans cette zone<input id="selection-modules" type="number" min="0.5" max="100" step="0.5" inputmode="decimal" placeholder="Ex. : 13" value="${escape(modules)}"></label><p class="hint">Largeur totale, pas nombre d’appareils. Un module = 18 mm.</p><button class="text-button" data-action="preview-selection">Vérifier les séparations</button>`:''}
    <p id="selection-count" class="selection-count">${area?`Zone sélectionnée${count?' · '+count+' découpe(s) proposée(s)':''}`:count+' appareil(s) sélectionné(s)'}</p>
    <button id="read-selection" class="primary full" data-action="read-selection" ${count||area?'':'disabled'}>Découper et lire</button>
    ${!session.candidates?.length&&!area?'<p class="hint">Pas de contours fiables : encadrez les appareils à lire.</p>':''}
    <details class="fine-settings"><summary>Ajuster les séparations à la main</summary><p class="hint">Les limites choisies doivent suivre une seule rangée.</p><div class="two-col"><button data-action="suggest">Rechercher dans la photo</button><button data-action="add-row">Ajouter une rangée</button></div><div id="manual-rows"></div><button data-action="crop" class="full" ${session.rows.length?'':'disabled'}>Créer les vignettes sans lecture</button><button data-action="crop-read" class="full" ${session.rows.length?'':'disabled'}>Lire les rangées ajustées</button></details>`;
}

export function dimensionsMarkup(device){
  const dimensions=reviewRecognitionDimensions(device),modules=dimensions.modules.valeur;
  return `<div class="dimension-note"><strong>${typeof modules==='number'?number(modules)+' module(s) · '+number(modules*18)+' mm':'Largeur à confirmer'}</strong>${dimensions.avertissements.map(w=>`<p class="dimension-warning">${escape(w)}</p>`).join('')}</div>`;
}

export function readingMarkup(device,{selected,total,previewUrl,showOriginal,validator,levelNames,widthEditable,editingFamily=false}){
  const family=device.labels.famille.valeur,visible=visibleFieldsForFamily(family),known=family!=='inconnu';
  const conflicts=incompatibleFieldsForFamily(family).filter(key=>device.labels[key]?.valeur&&device.labels[key].valeur!=='inconnu');
  const field=({key,label})=>key==='famille'&&known&&!editingFamily?`<div class="family-value"><span>Type d’appareil</span><strong>${escape(family)}</strong><button class="text-button" data-action="edit-family">Corriger le type</button></div>`:`<label>${key==='famille'?'Type d’appareil':label}${key==='famille'?`<select data-label="famille">${FAMILIES.map(value=>`<option ${family===value?'selected':''}>${escape(value)}</option>`).join('')}</select>`:`<input data-label="${key}" value="${escape(device.labels[key].valeur)}" ${key==='modules'?(widthEditable?'inputmode="decimal" placeholder="Ex. : 2,5"':'readonly'):''}>`}</label>`;
  return `<div class="device-heading"><h2>Appareil ${selected+1} sur ${total}</h2><span class="badge ${device.validatedAt?'validated':''}">${device.validatedAt?'Validé':'À vérifier'}</span></div>
    <div class="reading-preview"><img class="device-preview" src="${previewUrl}" alt="Découpe de l’appareil ${selected+1}">${dimensionsMarkup(device)}</div>
    ${!known?'<p class="hint">Type non identifié. Choisissez-le seulement si vous le reconnaissez.</p>':''}
    ${conflicts.length?`<div class="dimension-warning"><p>Des marquages lus ne correspondent pas au type retenu. Corrigez le type ou confirmez-le pour écarter ces caractéristiques.</p><button data-action="confirm-family">Confirmer ${escape(family)}</button></div>`:''}
    <div class="label-fields">${visible.map(field).join('')}</div>
    <label class="validator-field">Validation par<input data-validator value="${escape(validator)}" maxlength="100" autocomplete="name"></label>
    <button class="primary full" data-action="validate">Valider cet appareil</button>
    ${device.validatedAt?`<p class="validation-note">Validé par ${escape(device.validatedBy)}.</p><button data-action="invalidate">Remettre à vérifier</button>`:''}
    <div class="two-col navigation"><button data-action="previous" ${selected?'':'disabled'}>Précédent</button><button data-action="next" ${selected<total-1?'':'disabled'}>Suivant</button></div>
    <button class="text-button full" data-action="back-selection">Sélectionner d’autres appareils</button>
    <details class="recognition-details"><summary>Lecture, origine des données et outils</summary><p class="hint">${escape(device.recognition?.limites?.join(' ')||'Aucune lecture terminée.')}</p><pre>${escape(device.recognition?.texte||'Aucun texte lisible.')}</pre><dl class="field-origins">${visible.map(({key,label})=>`<div><dt>${escape(label)}</dt><dd>${escape(levelNames[device.labels[key].niveau]||device.labels[key].niveau)} · ${Math.round(device.labels[key].confiance*100)} %</dd></div>`).join('')}</dl><div class="stack"><button data-action="read-one" ${device.validatedAt?'disabled':''}>Relire cette vignette</button><button data-action="read-row">Relire la rangée</button>${device.cutoutBlob?`<button data-action="toggle-cutout">${showOriginal?'Voir le détourage':'Voir l’original'}</button>`:''}<button data-action="export-cutout">Télécharger ce PNG${device.cutoutBlob?' à fond transparent':' original'}</button></div><p class="hint">${escape(device.cutout?.reason||'Original conservé.')}</p></details>`;
}
