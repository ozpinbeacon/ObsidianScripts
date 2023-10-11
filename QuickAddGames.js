const notice = (msg) => new Notice(msg, 5000);
const log = (msg) => console.log(msg);

const AUTH_URL = "https://id.twitch.tv/oauth2/token";
const GRANT_TYPE = "client_credentials";

const API_CLIENT_ID_OPTION ="IGDB API Client ID"
const API_CLIENT_SECRET_OPTION ="IGDB API Client secret" 

const IGDB_PS5ID = 167
const IGDB_SwitchID = 130
const IGDB_PCID = 6

var userData = {igdbToken: ""};
var AUTH_TOKEN;

module.exports = {
  entry: start,
  settings: {
    name: "Videogames Script",
    author: "Elaws",
    options: {
      [API_CLIENT_ID_OPTION]: {
        type: "text",
        defaultValue: "",
        placeholder: "IGDB API Client ID",
      },
      [API_CLIENT_SECRET_OPTION]:{
        type: "text",
        defaultValue: "",
        placeholder: "IGDB API Client secret",
      },
    },
  },
};

let QuickAdd;
let Settings;
let savePath;

// Main

async function start(params, settings) {
	QuickAdd = params;
	Settings = settings;

	var relativePath = QuickAdd.app.vault.configDir;
	savePath = QuickAdd.obsidian.normalizePath(`${relativePath}/igdbToken.json`);

	// Retrieve saved token or create and save one (in Obsidian's system directory as igdbToken.json)
	// Token is generated from client ID and client secret, and lasts 2 months. 
	// Token is refreshed when request fails because of invalid token (every two months)
	await readIGDBToken();

	const query = await QuickAdd.quickAddApi.inputPrompt(
	"Enter videogame title: "
	);
	if (!query) {
		notice("No query entered.");
		throw new Error("No query entered.");
	}

	const searchResults = await getIGDBInfoByQuery(query);
	
	const selectedGame = await QuickAdd.quickAddApi.suggester(
		searchResults.map(formatTitleForSuggestion),
		searchResults
	);

	if (!selectedGame) {
		notice("No choice selected.");
		throw new Error("No choice selected.");
	}
	
	
	if(selectedGame.involved_companies)
	{
		var developer = (selectedGame.involved_companies).find(element => element.developer);
	}
	
	if(selectedGame.platforms) {
		var [platformID, platform] = formatPlatforms(selectedGame.platforms);
	}
	
	if(!platform) {
		notice("Not available on owned platforms.");
		throw new Error("Not available on owned platforms.");
	}
	
	if(selectedGame.release_dates) {
		var release_date = formatReleaseDate(selectedGame.release_dates, platformID);
	}
	
	var steamappID = await getSteamAppID(selectedGame.name)
	if(steamappID) {
		var [protonDBTier, protonDBLink] = await getProtonDBInfo(steamappID)
	} else {
		var [protonDBTier, protonDBLink] = ["N/A", "N/A"]
	}

	
	var [hltb_main, hltb_extra, hltb_100, hltb_url] = await getHLTBInfo(selectedGame.name)
	
	let recommender = await QuickAdd.quickAddApi.inputPrompt("Did anyone recommend this game?");
	if (!recommender) {
		recommender = "None"
	}
	
	QuickAdd.variables = {
		...selectedGame,
		fileName: replaceIllegalFileNameCharactersInString(selectedGame.name),
		//Developer name and logo
		developerName: `${developer ? developer.company.name : " "}`,
		developerLogo: `${developer ? (developer.company.logo ? ("https:" + developer.company.logo.url).replace("thumb", "logo_med") : " ") : " "}`,
		// For possible image size options, see : https://api-docs.igdb.com/#images
		thumbnail: `${selectedGame.cover ? "https:" + (selectedGame.cover.url).replace("thumb", "cover_big") : " "}`,
		// Release date is given as UNIX timestamp.
		release: `${selectedGame.first_release_date ? (new Date((selectedGame.first_release_date*1000))).getFullYear() : " "}`,
		// Full release date information for sorting
		releaseTimestamp: `${release_date ? release_date : "NULL"}`,
		// Platform for the games release
		platform: `${platform ? platform : "NULL"}`,
		// A short description of the game.
		storylineFormatted: `${selectedGame.storyline ? (selectedGame.storyline).replace(/\r?\n|\r/g, " ") : " "}`,
		// IGDB rating and then my rating
        criticRating: `${selectedGame.aggregated_rating ? formatCriticRating(selectedGame.aggregated_rating) : "0"}`,
		// Who recommended the game
		recommender: `${recommender ? recommender : ""}`,
		// All HLTB data
		hltb_main: `${hltb_main ? hltb_main : "NULL"}`,
		hltb_extra: `${hltb_extra ? hltb_extra : "NULL"}`,
		hltb_100: `${hltb_100 ? hltb_100 : "NULL"}`,
		hltb_url: `${hltb_url ? hltb_url : "NULL"}`,
		// All ProtonDB info
		protonDBTier: `${protonDBTier ? protonDBTier : "NULL"}`,
		protonDBLink: `${protonDBLink ? protonDBLink : "NULL"}`
	};
}

function formatTitleForSuggestion(resultItem) {
	return `${resultItem.name} (${
	(new Date((resultItem.first_release_date)*1000)).getFullYear()
	})`;
}

function formatReleaseDate(releaseDates, platformID) {
	for (let release of releaseDates) {
		if(platformID == release.platform) {
			var releaseDate = release.date;
		}
	}
	var dateObject = new Date(releaseDate*1000);
	var year = dateObject.getFullYear();
	var month = dateObject.getMonth() + 1;
	if(month < 10) {
		month = "0" + month;
	}
	var day = dateObject.getDate();
	if(day < 10) {
		day = "0" + day;
	}
	return year + "-" + month + "-" + day;
	
}

function formatCriticRating(criticRating) {
	return Math.round(criticRating);
}

function formatPlatforms(platforms) {
	if(platforms.includes(IGDB_PCID)) {
		return [IGDB_PCID, "PC"];
	} else if(platforms.includes(IGDB_PS5ID)) {
		return [IGDB_PS5ID, "PS5"];
	} else if(platforms.includes(IGDB_SwitchID)) {
		return [IGDB_SwitchID, "Switch"];
	}
}

async function getIGDBInfoByQuery(query) {

    const searchResults = await getIGDBGame(query);

	if(searchResults.message)
    {
      await refreshIGDBAuthToken();
      return await getIGDBInfoByQuery(query);
    }

    if (searchResults.length == 0) {	
      notice("No results found.");
      throw new Error("No results found.");
    }

    return searchResults;
}

function formatList(list) {
	if (list.length === 0 || list[0] == "N/A") return " ";
	if (list.length === 1) return `${list[0]}`;

	return list.map((item) => `\"${item.trim()}\"`).join(", ");
}

function replaceIllegalFileNameCharactersInString(string) {
	return string.replace(/[\\,#%&\{\}\/*<>$\":@.]*/g, "");
}

async function readIGDBToken(){

	if(await QuickAdd.app.vault.adapter.exists(savePath))
	{ 
		userData = JSON.parse(await QuickAdd.app.vault.adapter.read(savePath));
		AUTH_TOKEN = userData.igdbToken;
	} 
	else {
		await refreshIGDBAuthToken();
	}
}

async function refreshIGDBAuthToken(){

	const authResults = await getIGDBAuthToken();

	if(!authResults.access_token){
		notice("Auth token refresh failed.");
    	throw new Error("Auth token refresh failed.");
	} else {
		AUTH_TOKEN = authResults.access_token;
		userData.igdbToken = authResults.access_token;
		await QuickAdd.app.vault.adapter.write(savePath, JSON.stringify(userData));
	}
}

async function getIGDBAuthToken() {
	let finalURL = new URL(AUTH_URL);

	finalURL.searchParams.append("client_id", Settings[API_CLIENT_ID_OPTION]);
	finalURL.searchParams.append("client_secret", Settings[API_CLIENT_SECRET_OPTION]);
	finalURL.searchParams.append("grant_type", GRANT_TYPE);
	
	const res = await request({
		url: finalURL.href,
		method: 'POST',
		cache: 'no-cache',
		headers: {
			'Content-Type': 'application/json'
		}	
	})
	return JSON.parse(res);
}

async function getIGDBGame(query) {

	try {
		const res = await request({
			url: "https://api.igdb.com/v4/games", 
			method: 'POST',
			cache: 'no-cache',
			headers: {
				'Client-ID': Settings[API_CLIENT_ID_OPTION],
				'Authorization': "Bearer " + AUTH_TOKEN 
			},
			// The understand syntax of request to IGDB API, read the following :
			// https://api-docs.igdb.com/#examples
			// https://api-docs.igdb.com/#game
			// https://api-docs.igdb.com/#expander
			body: "fields name, first_release_date, involved_companies.developer, involved_companies.company.name, involved_companies.company.logo.url, url, cover.url, genres.name, game_modes.name, aggregated_rating, release_dates.platform, release_dates.date, platforms, storyline, status; search \"" + query + "\"; where release_dates.platform = (" + IGDB_PCID + ", " + IGDB_PS5ID + ", " + IGDB_SwitchID + "); limit 15;"
		})
			
		return JSON.parse(res);
	} catch (error) {	
		await refreshIGDBAuthToken();
		return await getIGDBInfoByQuery(query);
	}
}

// ProtonDB Information

async function getProtonDBInfo(appID) {
	const res = await request({
		url: "https://www.protondb.com/api/v1/reports/summaries/" + appID + ".json",
		method: "GET"
	})
	const data = JSON.parse(res)
	// Capitalize the ProtonDB tier, I'm pedantic
	let tier = data.tier.charAt(0).toUpperCase() + data.tier.slice(1);
	let url = "https://www.protondb.com/app/" + appID;
	
	// Return as a tuple
	return [tier, url];
}

async function getSteamAppID(query) {
	// Search Steam for appid, obviously includes apps on Steam but surprisingly includes a ton of non-steam games
	const res = await request({
		url: "https://steamcommunity.com/actions/SearchApps/" + query,
		method: 'GET',
		cache: 'no-cache'
	})
	try {
		const data = JSON.parse(res)
		return data[0].appid;
	} catch(err) {
		return false
	}
}

// HLTB Information

async function getHLTBInfo(query) {
	// Define search options, basically just look for the game name and grab the first result
	let payload = JSON.stringify({
		"searchType": "games",
		"searchTerms": query.split(" "),
		"searchPage": 1,
		"size": 20,
		"searchOptions": {
			"games": {
				"userId": 0,
				"platform": "",
				"sortCategory": "popular",
				"rangeCategory": "main",
				"rangeTime": {
					"min": 0,
					"max": 0,
				},
				"gameplay": {
					"perspective": "",
					"flow": "",
					"genre": "",
				},
				"modifier": "",
			},
			"users": {
				"sortCategory": "postcount",
			},
			"filter": "",
			"sort": 0,
			"randomizer": 0,
		}
	})

	// Looks like UA has to be set to a real value, auto generated ones like Curl seem to be blocked
	const res = await request({
		url: "https://howlongtobeat.com/api/search",
		method: 'POST',
		cache: 'no-cache',
		headers: {
			'Content-Type': "application/json",
			'Origin': "https://howlongtobeat.com",
			'Referer': "https://howlongtobeat.com",
			'User-Agent': "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
		},
		body: payload
	})
	const data = JSON.parse(res)
	// Create a link to the website for storage
	let url = "https://howlongtobeat.com/game/" + data.data[0].game_id

	// HLTB stores values in seconds, so convert to hours and round to 1 decimal place
	hltb_main = (data.data[0].comp_main / 3600).toFixed(1)
	hltb_plus = (data.data[0].comp_plus / 3600).toFixed(1)
	hltb_100 = (data.data[0].comp_100 / 3600).toFixed(1)

	// Return as a tuple
	return [hltb_main, hltb_plus, hltb_100, url]
}
