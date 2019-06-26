const Discord = require('discord.js');
const Util = require('./utils.js')
const client = new Discord.Client();
const config = require("./config");
const tables = require("./tables");
const mapsConst = tables.maps;
const axisConst = tables.axisdivs;
const alliesConst = tables.allydivs;
const sql = require("./sql.js");



client.login(config.token);

client.on('ready' , () => {
});



function process(message) {
	if(message.channel.type === 'text'){
		if(message.content.startsWith("$setup")){
			setup(message);
		}
	
		if(message.content.startsWith("test")){
			test(message);
		}
	
		if(message.content.startsWith("$reg")){
			sql.register(message);
		}
		if(message.content.startsWith("unreg")){
			sql.unreg(message);
		}
		if(message.content.startsWith("$commitWin")){
			commit(message,1);
		}
		if(message.content.startsWith("$commitLose")){
			commit(message,0);
		}
		if(message.content.startsWith("$stats")){
			sql.getStats(message,message.author);
		}
	}
}



async function test(message){
	//sql.recalcRating();
}


async function setup(message){

	let size = Math.ceil(message.mentions.users.array().length / 2);
	if(size>4){
		message.reply(`максимальный размер матча 4 на 4`);
		return;
	}
	if(!message.mentions.users.has(message.author.id)){
		message.reply(`Необходимо упомянуть себя, только администраторы могут создавать матчи без своего участия`);
	}
	let teamOne;
	let teamTwo;
	if(message.mentions.users.size == size*2){
		teamOne = message.mentions.users.array().slice(0,size);
		teamTwo = message.mentions.users.array().slice(size);
	} else{
		message.reply(`Необходимо упомянуть ${size*2} пользователей`);
		return;
	}
	

	try{

		//проверить все ли игроки могут участвовать в матче(зарегестрированны и нет текущего матча)
		await sql.canPlay(message.mentions.users.array());

		//запросить подтверждение всех игроков
		await Util.confirm(message,message.mentions.users.array(),`Подтвердите участие в матче
${teamOne.map(u=>{return `<@${u.id}>`}).join(' ')}
против
${teamTwo.map(u=>{return `<@${u.id}>`}).join(' ')}` ,60000);

		//определить стороны случайным образом	
		let axisTeam;
		let alliesTeam;

		if(Util.random([0,1]) === 0){
			axisTeam = teamOne;
			alliesTeam = teamTwo;
		} else {
			alliesTeam = teamOne;
			axisTeam = teamTwo;
		}

		message.channel.send(`Союзники: ${alliesTeam.map(u=>{return `<@${u.id}>`}).join(' ')}
Ось: ${axisTeam.map(u=>{return `<@${u.id}>`}).join(' ')}`);

		//провести баны карт
		
		let maps = mapsConst[size*2];
		let mapBans = new Array(0);

		if(size < 4){
			let answer = await Util.select(message,maps,2,alliesTeam);
			maps = maps.filter(x=> answer.indexOf(x)<0);
			mapBans.push(answer);

			answer = await Util.select(message,maps,2,axisTeam);
			maps = maps.filter(x=> answer.indexOf(x)<0);
			mapBans.push(answer);
		}
		
		//выбрать случайную из оставшихся
		let map = Util.random(maps);

		message.channel.send(`Случайная карта: ${map}`);

		//баны дивизий
		let alliesBan = await Util.select(message, alliesConst, 2, axisTeam);
		let axisBan = await Util.select(message, axisConst, 2, alliesTeam);

		let alliesAvalibleList = alliesConst.filter(x => alliesBan.indexOf(x)<0);
		let axisAvalibleList = axisConst.filter(x => axisBan.indexOf(x)<0);

		let sidesArray = Array(0);

		//выбор дивизий
		for(let i=0;i<size;i++){
			let div = await Util.select(message, axisAvalibleList, 1, [axisTeam[i]] );
			
			let div2 = await Util.select(message, alliesAvalibleList, 1, [alliesTeam[i]] );

			sidesArray.push({ id: axisTeam[i].id, side: 1, division: div[0] });
			sidesArray.push({ id: alliesTeam[i].id, side: 0, division: div2[0] });
		}

	
		//матч собран
		//записать данные о матче, сторонах, банах и заблокировать игроков в базе данных

		let matchid = await sql.regMatch(size, sidesArray, mapsConst[size*2].indexOf(map) ,mapBans, alliesBan, axisBan);

		//вывести информацию о собранном матче

		message.channel.send(`Матч №${matchid}
${size}v${size}
Карта: ${map}
Союзники: 
${sidesArray.filter(e=>{return e.side === 0}).map(e=>{return `<@${e.id}> : ${e.division}`}).join(`\n`)}
Ось: 
${sidesArray.filter(e=>{return e.side === 1}).map(e=>{return `<@${e.id}> : ${e.division}`}).join(`\n`)}
Для подтверждения результатов матча используйте команду $commitWin или $commitLose`);
	} catch(err) {
		message.channel.send(`${err}, матч отменён`);
		return;
	}
}


async function commit(message,wl){

	try{
		let matchid = await sql.getPlayerCurrentMatch(message.author);
		if(matchid != null){

			let players = await sql.getMatchSides(matchid);
			let authorSide = players.find(player => player.id === message.author.id).side;

			let result =!wl^authorSide; // 0 = allies wdin , 1= axis win

			let playersToConfirm = players.filter(p => p.side != authorSide);

			let description = `${playersToConfirm.map(p=>{return `<@${p.id}>`}).join(` `)}\n Вы ${wl==1?'проиграли':'победили'} в матче №${matchid}, подтвердите`;

			if(await Util.confirm(message,playersToConfirm,description,60000,1)){

				sql.commit(matchid,result);

				let eloChanges = await sql.updateRating(players.filter(p => p.side==0),players.filter(p=>p.side == 1), result, players.length/2 );

				message.channel.send(`Результат матча №${matchid} подтверждён!
Выигравшая сторона: ${result==0?'Союзники':'Ось'}
Изменения в рейтинге:
${eloChanges.map(p =>{return `<@${p.id}> ${p.elo} => ${p.newElo}`}).join('\n')}`);

			}

		} else {
			message.reply("не найден текущий матч");
		}
	} catch (err){
		message.reply(err);
	}
}

client.on("message", process);





