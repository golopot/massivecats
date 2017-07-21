'use strict'

const app = {}
app.consts = {
	MARK_MEMBER: true,
}
app.mode = ! app.consts.MARK_MEMBER
app.links = []
app.targetCategory = ''
app.version = '0.0.1'
app.name = 'cat-tool ' + app.version
app.token = ''


function LinkThingy(node, title){
	this.node = node
	this.title = title
	this.visited = false
	this.redirected = false
	this.destTitle = ''
	this.isMember = false
	this.isMemberOfChild = false
}


function toQueryString(obj){
	const valToStr = x => encodeURIComponent( Array.isArray(x) ? x.join('|') : x )
	return Object.keys(obj).map( x => x + '=' + valToStr(obj[x]) ).join('&')
}

// function findSubcat(cat){
// 	var url ='/w/api.php?action=query&list=categorymembers'
//
// 	var body = toQueryString({
// 		format: 'json',
// 		cmlimit: '40',
// 		cmtype: 'subcat',
// 		cmtitle: 'Category:'+cat,
// 	})
// 	return fetch(url, {method: 'POST', body})
// 	.then( r => r.json() )
// 	.then( checkError )
// 	.catch( e => console.error(e) )
// }


function doTheThing(){

	function getTitleFromUrl(url){
		var index = url.indexOf('/wiki/')
		if( index == -1 )
			return -1
		else
			return decodeURIComponent(url.slice(index + 6))
	}

	function getHostName(str){
		try{return new URL(str).hostname}
		catch(e){return -1}
	}


	var cat = document.querySelector('.cat-tool-root input[name="cat-input"]').value
		.replace('category:', '')
		.replace('Category:', '')
		.trim()
	app.targetCategory = cat
	localStorage['cat-tool-cat-input'] = cat

	var links = Array.from(document.querySelectorAll('#bodyContent a'))
		.filter( x => x.href.indexOf('#') === -1 )
		.filter( x => getHostName(x.href) == location.hostname )
		.map( x => new LinkThingy(x, getTitleFromUrl(x.href)) )
		.filter( x => x.title !== -1 )
		.filter( x => x.title.slice(0,9).toLowerCase() != 'category:' )

	app.links = links

	var chunks = []
	var chunkSize = 40
	for(var i=0; i<links.length; i += chunkSize){
		chunks.push(links.slice(i, i+chunkSize))
	}

	Promise.all(chunks.map( links => runOneChunk(links, cat) ))
	.then( x => console.log('Link query completed.'))
	.catch( e => console.error(e))
}


function runOneChunk(links, cat){
	return fetchCategoryOfTitle(links, cat)
	.then( r => processResponse(links, r) )
	.then( links => decorateLinks(links) )
	.catch( e => console.error(e) )

}


function fetchCategoryOfTitle(links, cat){
	var titles = links.map( x => x.title )
	var url ='/w/api.php?action=query&prop=categories&'

	var body = toQueryString({
		format: 'json',
		cllimit: '490',
		redirects: '1',
		titles: links.map( x => x.title),
		clcategories: 'Category:' + cat,
	})
	return fetch(url, {method: 'POST', body})
	.then( r => r.json() )
	.then( checkError )
	.catch( r => console.error(r) )
}


function processResponse(links, res){

	var pages = res.query.pages
	var p = {}
	for(var key in pages){
		p[ pages[key].title ] = pages[key]
	}


	const titleTransform = titleTransformBuilder(res)

	function titleTransformBuilder(res){
	 	const normalizer = {}
		for(let x of res.query.normalized || []){
			normalizer[x.from] = x.to
		}
		const redirecter = {}
		for(let x of res.query.redirects || []){
			redirecter[x.from] = x.to
		}
		const titleTransform = function(title){
			title = normalizer[title] || title
			return {
				title: redirecter[title] || title,
				redirected: redirecter[title] ? true:false
			}
		}
		return titleTransform
	}


	for(var link of links){
		link.visited = true
		var foo = titleTransform(link.title)
		link.destTitle = foo.title
		link.redirected = foo.redirected
		if(p[link.destTitle] && p[link.destTitle].categories){
			link.isMember = true
		}

	}

	return links
}


function cleanDecorations(){
	Array.from(document.querySelectorAll('.cat-tool-trashable'))
		.forEach( x => x.remove() )

	Array.from(document.querySelectorAll('.cat-tool-mark'))
		.forEach( x => x.classList.remove('cat-tool-mark') )

}


function decorateLinks(links){
	for(let link of links){
		var selected = link.isMember == app.mode
		if(selected){
			link.node.classList.add('cat-tool-mark')


			var spanR = document.createElement('span')
			spanR.innerHTML = link.redirected ? ` -> ${link.destTitle}` : ''
			spanR.classList.add('cat-tool-trashable')

			var span = document.createElement('span')
			span.innerHTML = app.mode ? '-' : '+'
			span.classList.add('cat-tool-button')
			span.classList.add('cat-tool-trashable')

			link.node.after(span)
			link.node.after(spanR)

			var handler = app.mode ? removePageFromCategory : addPageToCategory
			span.addEventListener('click', () => handler(link, app.targetCategory) )
		}

	}
}


function addPageToCategory(link, category){

	function wikitextAddCategory(text, category, isTemplate){

		var cat = category[0].toUpperCase() + category.slice(1)
		var line = `[[Category:${cat}]]`
		if( text.indexOf(line) !== -1 ){
			return Promise.reject('text already has the category.')
		}

		var out = ''

		if(!isTemplate){
			out = text.replace(/\n*$/, '\n') + line + '\n'
		}

		if(isTemplate){
			const ind = text.indexOf('</noinclude>')
			if(ind == -1){
				out = text.reaplce(/\n*$/,'') +`<noinclude>\n${line}\n</noinclude>`
			}
			else{
				out = text.slice(0, ind).replace(/\n*$/, '\n')
					+ line + '\n'
					+ text.slice(ind)
			}
		}

		return out
	}

	var isTemplate = link.destTitle.slice(0,9) === 'Template:'
	var summary = `add [[:Category:${category}]] using ${app.name}.`
	getRevision(link.destTitle)
	.then( text => wikitextAddCategory(text, category, isTemplate) )
	.then( text => writeRevision(link.destTitle, text, summary) )
	.then( res => modifyLinkView(res, link) )
	.catch( e => console.error(e) )
}


function removePageFromCategory(link, category){

	function wikitextRemoveCategory(text, category){
		var i = category
		var k = '[' + i[0].toUpperCase() + i[0].toLowerCase() + ']' + i.slice(1)
		var re = new RegExp(`\n?\\[\\[ ?[Cc]ategory ?: ?${k} ?\]\]`)
		if(!re.test(text)){
			throw(new Error('Cannot find category in wikitext.'))
			console.error('Cannot find category in wikitext.')
		}
		return text.replace(re, '')
	}

	var summary = `remove [[:Category:${category}]] using ${app.name}.`
	getRevision(link.destTitle)
	.then( text => wikitextRemoveCategory(text, category ) )
	.then( text => writeRevision(link.destTitle, text, summary) )
	.then( res => modifyLinkView(res, link) )
}

function checkError(r){
	if(r.error) return Promise.reject(r.error)
	if(r.warnings) return Promise.reject(r.warnings)
	return r
}


function getRevision(title){
	var url = '/w/api.php?action=query&prop=revisions&rvprop=content&redirects=1&format=json'
		+ `&titles=${title}`

	return fetch(url, {headers: {'Cache-Control': 'no-cache'}} )
	.then( r => r.json() )
	.then( checkError )
	.then( x => {
		for(var key in x.query.pages)
			return x.query.pages[key].revisions[0]['*']
		return Promise.reject('')
	})

}


function writeRevision(title, text, summary){

	var token = app.token

	var url = `/w/api.php?action=edit&title=${encodeURIComponent(title)}`

	var body = toQueryString({
		text,
		summary,
		format: 'json',
		token: token,
	})

	var option = {
		method: 'POST',
		headers: {},
		body,
		credentials: 'include',
	}

	return fetch(url, option)
    .then( r => r.json() )
	.then( checkError )
    .catch( e => console.error(e) )

}


function modifyLinkView(res, link){
	if(res.edit.result == 'Success'){
		console.log('Success')
		link.isMember = ! app.mode
		cleanDecorations()
		decorateLinks(app.links)
	}else{
		console.log('Fail')
	}
}
// function getCatMember(cat, continueStr, lastData){
// 	var url = '/w/api.php?action=query&list=categorymembers&format=json'
// 		+ `&cmtitle=Category:${cat}`
// 		+ '&cmlimit=400&'
// 		+ (continueStr || '')
//
// 	return (
// 		fetch(url)
// 		.then( r => r.json() )
// 		.then( r => {
// 			var data = (lastData || []).concat(r.query.categorymembers)
// 			if( r.continue !== undefined ){
// 				var continueStr = `continue=${r.continue.continue}&cmcontinue=${r.continue.cmcontinue}`
// 				return getCatMember(cat, continueStr, data)
// 			}
// 			else{
// 				return Promise.resolve(data)
// 			}
// 		})
// 		.catch( e => Promise.reject(e) )
// 	)
//
// }

function changeMode(ev){
	app.mode = this
	cleanDecorations()
	decorateLinks(app.links)
}


function injectGadgetToView(){
	if( document.querySelector('.cat-tool-root')) return

	localStorage['cat-tool-open'] = 'yes'

	var div = document.createElement('div')
	div.classList.add('cat-tool-root')

	div.innerHTML =`
	<input name='cat-input' placeholder='Target category'>
	<button>run</button>
	<label><input name='member' type='radio'><span>Mark members</span></label>
	<label><input name='member' type='radio'><span>Mark non-members</span></label>
	<span class='cat-tool-close'>[close]</span>
	`
	var mainInput = div.querySelector('input[name="cat-input"]')
	mainInput.value = localStorage['cat-tool-cat-input'] || ''

	var inputM1 = div.querySelectorAll('input[name="member"]')[0]
	var inputM2 = div.querySelectorAll('input[name="member"]')[1]
	inputM1.checked = app.mode == app.consts.MARK_MEMBER
	inputM2.checked = ! inputM1.checked

	var button = div.querySelector('button')
	var closeButton = div.querySelector('.cat-tool-close')
	button.addEventListener('click', doTheThing)
	closeButton.addEventListener('click', () => {
		localStorage['cat-tool-open'] = '';
		document.querySelector('.cat-tool-root').remove()
	})
	inputM1.addEventListener('click', changeMode.bind(app.consts.MARK_MEMBER))
	inputM2.addEventListener('click', changeMode.bind( ! app.consts.MARK_MEMBER))


	var content = document.querySelector('#bodyContent')
	content.childNodes[0].before(div)

}


function injectButtonToView(){
	var li = document.createElement('li')
	var span = document.createElement('span')
	span.innerHTML = 'Cat tool'
	span.style.color = '#0645ad'
	span.style.cursor = 'pointer'
	span.addEventListener('click', injectGadgetToView )
	li.appendChild(span)
	document.querySelector('#p-tb > .body > ul').appendChild(li)
}


function injectStyleToHead(){
	var style = document.createElement('style')
	style.innerHTML =
	`\
		.wpelc-count{
			font-size: small;
		}
		.cat-tool-mark, .cat-tool-mark:visited{
			color: green;
			font-weight: bold;
		}
		.cat-tool-root label{
			display: inline-block;
			vertical-align: middle;
		}
		.cat-tool-root input[type='radio']{
			margin-top: -2px;
			vertical-align: middle;
		}
		.cat-tool-root{
			line-height:22px;
		}
		.cat-tool-button{
			color: #0645ad;
			cursor: pointer;
			padding-left: 5px;
		}
		.cat-tool-close{
			color: #0645ad;
			cursor: pointer;
		}
	`

	document.head.appendChild( style )
}


function getEditToken(){
	return fetch(
		'/w/api.php?action=query&meta=tokens&format=json',
		{credentials: 'include'}
	)
	.then( r => r.json() )
	.then( checkError )
	.then( r => r.query.tokens.csrftoken )
}


function main(){
	injectStyleToHead()
	injectButtonToView()
	if(localStorage['cat-tool-open']){
		injectGadgetToView()
	}
	getEditToken().then( token => {app.token = token} ).catch( e => console.error(e))
	window.app = app
}

main()
