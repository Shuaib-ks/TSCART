const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function checkoutItems(products,cart,buyNow=null) {
  return (buyNow?[buyNow]:cart).map(item=>{
    const product=products.find(p=>p.id===item.id);
    return product?{...product,quantity:item.quantity}:null;
  }).filter(Boolean);
}
export function freeDeliveryTotals(items) {
  const subtotal=items.reduce((sum,item)=>sum+item.price*item.quantity,0);
  return {subtotal,shipping:0,total:subtotal};
}
export function ratingMarkup(product) {
  const count=Number(product.reviewCount)||0,average=Math.max(0,Math.min(5,Number(product.ratingAverage)||0));
  return `<span class="product-rating" aria-label="${count?average.toFixed(1)+' out of 5 stars, '+count+' '+(count===1?'review':'reviews'):'No reviews yet'}"><span class="star-meter" aria-hidden="true"><span>★★★★★</span><span class="star-fill" style="width:${average*20}%">★★★★★</span></span><span>${count?average.toFixed(1)+' · '+count+' '+(count===1?'review':'reviews'):'No reviews yet'}</span></span>`;
}
export function descriptionMarkup(items=[]) {
  if(!items.length)return '';
  return `<div class="description-media">${items.map(item=>`<figure>${item.type==='image'?`<img src="${esc(item.url)}" alt="${esc(item.caption||'Product detail')}" loading="lazy">`:item.type==='video'?`<video src="${esc(item.url)}" controls playsinline preload="metadata" aria-label="${esc(item.caption||'Product video')}"></video>`:`<audio src="${esc(item.url)}" controls preload="metadata" aria-label="${esc(item.caption||'Product audio')}"></audio>`}${item.caption?`<figcaption>${esc(item.caption)}</figcaption>`:''}</figure>`).join('')}</div>`;
}
export function mediaEditorRows(items=[]) {
  return items.map((item,index)=>`<div class="description-media-row" data-type="${esc(item.type)}"><div class="admin-actions"><strong>${index+1}. ${esc(item.type)}</strong><button type="button" class="btn outline small" data-action="media-up" data-index="${index}" ${index===0?'disabled':''} aria-label="Move media ${index+1} up">↑</button><button type="button" class="btn outline small" data-action="media-down" data-index="${index}" ${index===items.length-1?'disabled':''} aria-label="Move media ${index+1} down">↓</button><button type="button" class="btn outline small danger" data-action="media-remove" data-index="${index}">Remove</button></div><label class="field"><span>Media URL</span><input data-media-url value="${esc(item.url)}" maxlength="1200" required></label><label class="field"><span>Caption / image description (optional)</span><textarea data-media-caption maxlength="500">${esc(item.caption)}</textarea></label>${descriptionMarkup([item])}</div>`).join('');
}
export function mediaEditor(items=[]) {
  return `<div class="admin-card"><h2>Media in the description.</h2><p>Add images, videos or audio below your description text. Up to 10 files. Images: JPG, PNG, WebP or GIF, up to 5 MB. Video: MP4 or WebM; audio: MP3 or WAV, up to 20 MB.</p><input id="description-media-upload" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav" aria-label="Upload description media"><div class="form-grid space-top"><label class="field"><span>Media type</span><select id="description-media-type"><option value="image">Image</option><option value="video">Video</option><option value="audio">Audio</option></select></label><label class="field"><span>Or use a direct HTTPS media URL</span><input id="description-media-url" type="url" placeholder="https://…" maxlength="1200"></label></div><button class="btn small outline space-top" type="button" data-action="media-add-url">Add media URL</button><div id="description-media-list" class="space-top">${mediaEditorRows(items)}</div></div>`;
}
export function readMediaEditor(container) {
  return [...container.querySelectorAll('.description-media-row')].map(row=>({type:row.dataset.type,url:row.querySelector('[data-media-url]').value.trim(),caption:row.querySelector('[data-media-caption]').value.trim()}));
}
export function reviewCards(reviews,admin=false) {
  return reviews.map(review=>`<article class="review-card"><div class="review-heading"><strong>${esc(review.name)}</strong><time datetime="${new Date(review.created).toISOString()}">${new Date(review.created).toLocaleDateString('en-IN')}</time></div><div class="review-stars" aria-label="${review.rating} out of 5 stars">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</div><p>${esc(review.body)}</p>${admin?`<button class="btn small outline danger" type="button" data-action="delete-review" data-id="${review.id}">Delete review</button>`:''}</article>`).join('');
}
export function reviewMore(productId,data,admin=false) {
  return data.nextOffset===null?'':`<button type="button" class="btn small outline space-top" data-action="more-reviews" data-id="${productId}" data-offset="${data.nextOffset}" data-admin="${admin}">More reviews</button>`;
}
export function customerReviews(product,data) {
  return `<section class="customer-reviews" id="reviews"><div class="section-head"><div><h2>Customer reviews.</h2>${ratingMarkup({reviewCount:data.total,ratingAverage:data.ratingAverage})}</div></div><div class="review-columns"><div><div id="public-review-list">${data.reviews.length?reviewCards(data.reviews):'<p class="muted">No reviews yet. Share your experience with this product.</p>'}</div><div id="public-review-more">${reviewMore(product.id,data)}</div></div><form id="review-form" class="admin-card" data-id="${product.id}"><h3>Write a review</h3><fieldset class="rating-choice"><legend>Your rating *</legend><div class="star-options">${[1,2,3,4,5].map(n=>`<label class="rating-option"><input type="radio" name="rating" value="${n}" required aria-label="${n} ${n===1?'star':'stars'}"><span aria-hidden="true">☆</span></label>`).join('')}</div></fieldset><label class="field"><span>Display name *</span><input name="name" required minlength="2" maxlength="60" autocomplete="nickname"></label><label class="field space-top"><span>Your review *</span><textarea name="body" required minlength="10" maxlength="2000" placeholder="Tell others about your experience."></textarea></label><p class="fine">Your display name, rating and review will be public. Please leave out personal contact or delivery details.</p><div class="form-error" role="alert"></div><button class="btn small" type="submit">Submit review</button></form></div></section>`;
}
export function adminReviews(product,data) {
  return `<div class="admin-card space-top" id="admin-reviews"><h2>Customer reviews.</h2>${ratingMarkup({reviewCount:data.total,ratingAverage:data.ratingAverage})}<div id="admin-review-list">${data.reviews.length?reviewCards(data.reviews,true):'<p>No reviews yet.</p>'}</div><div id="admin-review-more">${reviewMore(product.id,data,true)}</div></div>`;
}
