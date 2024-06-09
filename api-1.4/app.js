/**
 * Copyright 2017 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an 'AS IS' BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
'use strict';
const { run } = require('./connectMongodb.js')
var log4js = require('log4js');
var logger = log4js.getLogger('SampleWebApp');
var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var util = require('util');
var app = express();
var expressJWT = require('express-jwt');
var jwt = require('jsonwebtoken');
var bearerToken = require('express-bearer-token');
var cors = require('cors');
const prometheus = require('prom-client')
const ethers = require('ethers');
require('./config.js');
var hfc = require('fabric-client');

var helper = require('./app/helper.js');
var createChannel = require('./app/create-channel.js');
var join = require('./app/join-channel.js');
var install = require('./app/install-chaincode.js');
var instantiate = require('./app/instantiate-chaincode.js');
var invoke = require('./app/invoke-transaction.js');
var query = require('./app/query.js');
var host = process.env.HOST || hfc.getConfigSetting('host');
var port = 3000;
const crypto = require('crypto');       //sha256 Object
const { transporter } = require('./sendMail.js')
var client = run()
app.options('*', cors());
app.use(cors());
//support parsing of application/json type post data
app.use(bodyParser.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({
	extended: false
}));
// set secret variable
app.set('secret', 'thisismysecret');
app.use(expressJWT({
	secret: 'thisismysecret'
}).unless({
	path: ['/users/login', '/users/register', '/users/login/validateOTP', '/users/register/validateOTP', 'users/resendOTP', '/users/registerHP','/ping']
}));
app.use(bearerToken());
app.use(function (req, res, next) {
	logger.debug(' ------>>>>>> new request for %s', req.originalUrl);
	if (req.originalUrl.indexOf('/users') >= 0 || req.originalUrl.indexOf('/ping')>=0) {
		return next();
	}

	var token = req.token;
	jwt.verify(token, app.get('secret'), function (err, decoded) {
		if (err) {
			res.send({
				success: false,
				message: 'Failed to authenticate token. Make sure to include the ' +
					'token returned from /users call in the authorization header ' +
					' as a Bearer token'
			});
			return;
		} else {
			// add the decoded user name and org name to the request object
			// for the downstream code to use
			req.id = decoded.id;
			req.iat = decoded.iat;
			logger.debug(util.format('Decoded from JWT token: id - %s, iat - %s', decoded.id, decoded.iat));
			return next();
		}
	});
});

///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// START SERVER /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
var server = http.createServer(app).listen(port, function () { });
logger.info('****************** SERVER STARTED ************************');
logger.info('***************  http://%s:%s  ******************', host, port);
server.timeout = 240000;

function getErrorMessage(field) {
	var response = {
		success: false,
		message: field + ' field is missing or Invalid in the request'
	};
	return response;
}
async function convertFromAuthToHyper(req) {
	try {
		const collection = (await client).db("Autheticate").collection("hyperledger_accounts")
		const document = await collection.findOne({ acc_id: req.id });
		if (document) {
			return { username: document.username, orgname: document.Orgid }
		}
		return false

	} catch (err) {
		console.error('Error:', err);
	}

}
async function sendOTP(email, OTP) {
	try {
		const mailOptions = {
			from: "chitkenkhoi@gmai.com",
			to: [email],
			subject: "OTP for authentication",
			text: `Your OTP code is ${OTP}`,
		}
		await transporter.sendMail(mailOptions);
		return true
	} catch (error) {
		console.log(error)
		return false
	}

}

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDPOINTS START HERE ///////////////////////////
///////////////////////////////////////////////////////////////////////////////
// Register and enroll user
app.get('/token/validate', async function (req, res) {
	res.json({
		message: "Valid token"
	})
})
app.post('/users/register', async function (req, res) {
	try {
		var credential = req.body.email
		const db = (await client).db("Autheticate")
		const document = await db.collection("accounts").findOne({ credential: credential })
		if (document) {
			var response = {
				message: "Email has been registered"
			}
			res.json(response)
			return
		}
		const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
		let otp = '';
		for (let i = 0; i < 6; i++) {
			otp += chars[Math.floor(Math.random() * chars.length)];
		}
		if (await sendOTP(credential, otp)) {
			const insertOTP = async () => {
				const col = db.collection("OTPcode")
				const doc = { credential: credential, OTP: otp }
				const result = await col.insertOne(doc)
			}
			insertOTP();
			var response = {
				message: "OTP sent"
			}
			const cleanOldDoc = await db.collection("CacheRegister").deleteMany({ credential: credential })        //xoá hết mk cũ trong cache
			const sha256Hash = crypto.createHash('sha256');
			sha256Hash.update(req.body.password);
			var hash_password = sha256Hash.digest('hex');
			const doc = { credential: credential, hash_password: hash_password }
			const result = await db.collection("CacheRegister").insertOne(doc)
		} else {
			var response = {
				message: "OTP not sent"
			}
		}
		res.json(response)
	} catch (e) {
		console.log(e)
	}
})
app.post('/users/register/validateOTP', async function (req, res) {
	try {
		const OTP = req.body.OTP
		const email = req.body.email
		const db = (await client).db("Autheticate")

		var doc = await db.collection("OTPcode").findOne({ credential: email, OTP: OTP });
		if (doc) {
			await db.collection("OTPcode").deleteMany({ credential: email })
			const cache_doc = await db.collection("CacheRegister").findOne({ credential: email })                  //tìm mật khẩu
			const randomWallet = ethers.Wallet.createRandom();
			const publickey = randomWallet.address;
			const privatekey = randomWallet.privateKey;

			var document = { public_key: publickey, private_key: privatekey, credential: email, hash_password: cache_doc.hash_password }
			const result = await db.collection("accounts").insertOne(document)
			var token = jwt.sign({
				exp: Math.floor(Date.now() / 1000) + parseInt(hfc.getConfigSetting('jwt_expiretime')),
				id: result._id
			}, app.get('secret'));
			var response = {
				message: "Auth ok",
				token: token
			}
			await db.collection("CacheRegister").deleteMany({ credential: email })
		} else {
			var response = {
				message: "OTP is wrong"
			}
		}
		res.json(response)

	} catch (e) {
		console.log(e)
	}
})
app.post('/registerHP', async function (req, res) {
	try {
		const db = (await client).db("Autheticate")
		const doc = await db.collection("hyperledger_accounts").findOne({ acc_id: req.id })
		if (doc) {
			var re = {
				message: "Registered"
			}
			res.json(re)
			return
		}
		var username = req.body.username;
		var orgName = req.body.orgName;
		logger.debug('End point : /users/register');
		logger.debug('User name : ' + username);
		logger.debug('Org name  : ' + orgName);
		if (!username) {
			res.json(getErrorMessage('\'username\''));
			return;
		}
		if (!orgName) {
			res.json(getErrorMessage('\'orgName\''));
			return;
		}
		let response = await helper.getRegisteredUser(username, orgName, true);
		logger.debug('-- returned from registering the username %s for organization %s', username, orgName);
		if (response && typeof response !== 'string') {
			logger.debug('Successfully registered the username %s for organization %s', username, orgName);
			const docToInsert = { Orgid: orgName, acc_id: req.id, username: username };
			const result = await db.collection("hyperledger_accounts").insertOne(docToInsert)
			const r = {
				success: true,
				message: "Registered successfully"
			}
			res.json(r)
		} else {
			logger.debug('Failed to register the username %s for organization %s with::%s', username, orgName, response);
			res.json({ success: false, message: response });
		}
	} catch (e) {
		console.log(e)
	}


});
app.get('/ping',async function(req,res){
	res.json({
		message:"Pong"
	})
})
app.post('users/resendOTP', async function (req, res) {
	try {
		const email = req.body.email
		const db = (await client).db("Autheticate")
		const document = await db.collection("OTPcode").findOne({ credential: email })
		if (document) {
			await db.collection("OTPcode").deleteOne({ _id: document._id })
		}
		const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
		let otp = '';
		for (let i = 0; i < 6; i++) {
			otp += chars[Math.floor(Math.random() * chars.length)];
		}
		if (await sendOTP(email, otp)) {
			const insertOTP = async () => {
				const col = db.collection("OTPcode")
				const doc = { credential: email, OTP: otp }
				const result = await col.insertOne(doc)
			}
			insertOTP();
			var response = {
				message: "OTP sent"
			}
		} else {
			var response = {
				message: "OTP not sent"
			}
		}
		res.json(response)
	} catch (e) {
		console.log(e)
	}
})
app.post('/users/login/validateOTP', async function (req, res) {
	try {
		const OTP = req.body.OTP
		const email = req.body.email
		const db = (await client).db("Autheticate")

		var doc = await db.collection("OTPcode").findOne({ credential: email, OTP: OTP });
		if (doc) {
			const result = await db.collection("accounts").findOne({ credential: email })
			await db.collection("OTPcode").deleteOne({ _id: doc._id })
			var token = jwt.sign({
				exp: Math.floor(Date.now() / 1000) + parseInt(hfc.getConfigSetting('jwt_expiretime')),
				id: result._id
			}, app.get('secret'));
			var response = {
				message: "Auth ok",
				token: token
			}
		} else {
			var response = {
				message: "OTP is wrong"
			}
		}
		res.json(response)

	} catch (e) {
		console.log(e)
	}
})
//Login to an existing user
app.post('/users/login', async function (req, res) {
	try {
		var credential = req.body.email
		const sha256Hash = crypto.createHash('sha256');
		sha256Hash.update(req.body.password);
		var hash_password = sha256Hash.digest('hex');
		console.log("This is", hash_password);
		const collection = (await client).db("Autheticate").collection("accounts")
		await collection.findOne({ credential: credential, hash_password: hash_password }, (err, document) => {
			if (!document) {
				res.json(getErrorMessage('\'credential or password\''))
				return
			}
			const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
			let otp = '';
			for (let i = 0; i < 6; i++) {
				otp += chars[Math.floor(Math.random() * chars.length)];
			}
			if (sendOTP(credential, otp)) {
				const insertOTP = async () => {
					const col = (await client).db("Autheticate").collection("OTPcode")
					var doc = await col.findOne({ credential: credential });
					if (doc) {

					} else {
						await col.deleteOne({ _id: document._id });
					}
					doc = { credential: credential, OTP: otp }
					const result = await col.insertOne(doc)
				}
				insertOTP();
				var response = {
					message: "OTP sent"
				}
			} else {
				var response = {
					message: "OTP not sent"
				}
			}
			// var token = jwt.sign({
			// 	exp: Math.floor(Date.now() / 1000) + parseInt(hfc.getConfigSetting('jwt_expiretime')),
			// 	id: document._id
			// }, app.get('secret'));
			// var response = {
			// 	message: "Auth ok",
			// 	token: token
			// }
			res.json(response)
		})
	} catch (er) {
		console.log(er)
	}


	// var username = req.body.username;
	// var orgName = req.body.orgName;
	// logger.debug('End point : /users/login');
	// logger.debug('User name : ' + username);
	// logger.debug('Org name  : ' + orgName);
	// if (!username) {
	// 	res.json(getErrorMessage('\'username\''));
	// 	return;
	// }
	// if (!orgName) {
	// 	res.json(getErrorMessage('\'orgName\''));
	// 	return;
	// }
	// var token = jwt.sign({
	// 	exp: Math.floor(Date.now() / 1000) + parseInt(hfc.getConfigSetting('jwt_expiretime')),
	// 	username: username,
	// 	orgName: orgName
	// }, app.get('secret'));
	// let response = await helper.getEnrolledUser(username, orgName, true);
	// logger.debug('-- returned from registering the username %s for organization %s', username, orgName);
	// if (response && typeof response !== 'string') {
	// 	logger.debug('Successfully registered the username %s for organization %s', username, orgName);
	// 	response.token = token;
	// 	res.json(response);
	// } else {
	// 	logger.debug('Failed to login the username %s for organization %s with::%s', username, orgName, response);
	// 	res.json({ success: false, message: response });
	// }

});
// Create Channel
app.post('/channels', async function (req, res) {
	logger.info('<<<<<<<<<<<<<<<<< C R E A T E  C H A N N E L >>>>>>>>>>>>>>>>>');
	logger.debug('End point : /channels');
	var channelName = req.body.channelName;
	var channelConfigPath = req.body.channelConfigPath;
	logger.debug('Channel name : ' + channelName);
	logger.debug('channelConfigPath : ' + channelConfigPath); //../artifacts/channel/mychannel.tx
	if (!channelName) {
		res.json(getErrorMessage('\'channelName\''));
		return;
	}
	if (!channelConfigPath) {
		res.json(getErrorMessage('\'channelConfigPath\''));
		return;
	}

	let message = await createChannel.createChannel(channelName, channelConfigPath, req.username, req.orgname);
	res.send(message);
});
// Join Channel
app.post('/channels/:channelName/peers', async function (req, res) {
	logger.info('<<<<<<<<<<<<<<<<< J O I N  C H A N N E L >>>>>>>>>>>>>>>>>');
	var channelName = req.params.channelName;
	var peers = req.body.peers;
	logger.debug('channelName : ' + channelName);
	logger.debug('peers : ' + peers);
	logger.debug('username :' + req.username);
	logger.debug('orgname:' + req.orgname);

	if (!channelName) {
		res.json(getErrorMessage('\'channelName\''));
		return;
	}
	if (!peers || peers.length == 0) {
		res.json(getErrorMessage('\'peers\''));
		return;
	}

	let message = await join.joinChannel(channelName, peers, req.username, req.orgname);
	res.send(message);
});
// Install chaincode on target peers
app.post('/chaincodes', async function (req, res) {
	logger.debug('==================== INSTALL CHAINCODE ==================');
	var peers = req.body.peers;
	var chaincodeName = req.body.chaincodeName;
	var chaincodePath = req.body.chaincodePath;
	var chaincodeVersion = req.body.chaincodeVersion;
	var chaincodeType = req.body.chaincodeType;
	logger.debug('peers : ' + peers); // target peers list
	logger.debug('chaincodeName : ' + chaincodeName);
	logger.debug('chaincodePath  : ' + chaincodePath);
	logger.debug('chaincodeVersion  : ' + chaincodeVersion);
	logger.debug('chaincodeType  : ' + chaincodeType);
	if (!peers || peers.length == 0) {
		res.json(getErrorMessage('\'peers\''));
		return;
	}
	if (!chaincodeName) {
		res.json(getErrorMessage('\'chaincodeName\''));
		return;
	}
	if (!chaincodePath) {
		res.json(getErrorMessage('\'chaincodePath\''));
		return;
	}
	if (!chaincodeVersion) {
		res.json(getErrorMessage('\'chaincodeVersion\''));
		return;
	}
	if (!chaincodeType) {
		res.json(getErrorMessage('\'chaincodeType\''));
		return;
	}
	let message = await install.installChaincode(peers, chaincodeName, chaincodePath, chaincodeVersion, chaincodeType, req.username, req.orgname)
	res.send(message);
});
// Instantiate chaincode on target peers
app.post('/channels/:channelName/chaincodes', async function (req, res) {
	logger.debug('==================== INSTANTIATE CHAINCODE ==================');
	var peers = req.body.peers;
	var chaincodeName = req.body.chaincodeName;
	var chaincodeVersion = req.body.chaincodeVersion;
	var channelName = req.params.channelName;
	var chaincodeType = req.body.chaincodeType;
	var fcn = req.body.fcn;
	var args = req.body.args;
	logger.debug('peers  : ' + peers);
	logger.debug('channelName  : ' + channelName);
	logger.debug('chaincodeName : ' + chaincodeName);
	logger.debug('chaincodeVersion  : ' + chaincodeVersion);
	logger.debug('chaincodeType  : ' + chaincodeType);
	logger.debug('fcn  : ' + fcn);
	logger.debug('args  : ' + args);
	if (!chaincodeName) {
		res.json(getErrorMessage('\'chaincodeName\''));
		return;
	}
	if (!chaincodeVersion) {
		res.json(getErrorMessage('\'chaincodeVersion\''));
		return;
	}
	if (!channelName) {
		res.json(getErrorMessage('\'channelName\''));
		return;
	}
	if (!chaincodeType) {
		res.json(getErrorMessage('\'chaincodeType\''));
		return;
	}
	if (!args) {
		res.json(getErrorMessage('\'args\''));
		return;
	}

	let message = await instantiate.instantiateChaincode(peers, channelName, chaincodeName, chaincodeVersion, chaincodeType, fcn, args, req.username, req.orgname);
	res.send(message);
});



// Invoke transaction on chaincode on target peers
app.post('/channels/:channelName/chaincodes/:chaincodeName', async function (req, res) {
	try {
		logger.debug('==================== INVOKE ON CHAINCODE ==================');
		const obj = await convertFromAuthToHyper(req)
		if (obj === false) {
			var response = {
				message: "Not register"
			}
			res.json(response)
			return
		}
		var peers = req.body.peers;
		var chaincodeName = req.params.chaincodeName;
		var channelName = req.params.channelName;
		var fcn = req.body.fcn;
		var args = req.body.args;
		logger.debug('channelName  : ' + channelName);
		logger.debug('chaincodeName : ' + chaincodeName);
		logger.debug('fcn  : ' + fcn);
		logger.debug('args  : ' + args);
		if (!chaincodeName) {
			res.json(getErrorMessage('\'chaincodeName\''));
			return;
		}
		if (!channelName) {
			res.json(getErrorMessage('\'channelName\''));
			return;
		}
		if (!fcn) {
			res.json(getErrorMessage('\'fcn\''));
			return;
		}
		if (!args) {
			res.json(getErrorMessage('\'args\''));
			return;
		}
		if (fcn === "signContract") {
			args.splice(1, 0, obj.orgname)
		} else if (fcn === "createContract") {
			args.splice(3, 0, obj.orgname);
			if (args[4] === "congty G") {
				args[4] = "Org1"
			} else {
				args[4] = "Org2"
			}
		} else if (fcn === "updateContractStakeholders") {
			args.splice(1, 0, obj.orgname)

		} else if (fcn === "updateContractProducts" || fcn === "updateContractTerms") {
			args.splice(1, 0, obj.orgname)
		}
		let message = await invoke.invokeChaincode(peers, channelName, chaincodeName, fcn, args, obj.username, obj.orgname);


		const response_payload = {
			result: message,
			error: null,
			errorData: null
		}
		res.send(response_payload);

	} catch (error) {
		const response_payload = {
			result: null,
			error: error.name,
			errorData: error.message
		}
		res.send(response_payload)
	}
});


// Query on chaincode on target peers
app.get('/channels/:channelName/chaincodes/:chaincodeName', async function (req, res) {
	logger.debug('==================== QUERY BY CHAINCODE ==================');
	const obj = await convertFromAuthToHyper(req)
	if (obj === false) {
		var response = {
			message: "Not register"
		}
		res.json(response)
		return
	}
	var channelName = req.params.channelName;
	var chaincodeName = req.params.chaincodeName;
	let args = req.query.args;
	let fcn = req.query.fcn;
	let peer = req.query.peer;
	if (fcn === "queryContractsByStakeholders") {
		var arr = [obj.orgname]
		args = JSON.stringify(arr)
	} else if (fcn === "queryContract") {
		var arr = JSON.parse(args)
		arr.splice(1, 0, obj.orgname)
		args = JSON.stringify(arr)
	}


	logger.debug('channelName : ' + channelName);
	logger.debug('chaincodeName : ' + chaincodeName);
	logger.debug('fcn : ' + fcn);
	logger.debug('args : ' + args);
	console.log("cos phai list ko ", typeof args === 'string')

	if (!chaincodeName) {
		res.json(getErrorMessage('\'chaincodeName\''));
		return;
	}
	if (!channelName) {
		res.json(getErrorMessage('\'channelName\''));
		return;
	}
	if (!fcn) {
		res.json(getErrorMessage('\'fcn\''));
		return;
	}
	if (!args) {
		res.json(getErrorMessage('\'args\''));
		return;
	}
	args = args.replace(/'/g, '"');
	args = JSON.parse(args);
	logger.debug(args);

	let message = await query.queryChaincode(peer, channelName, chaincodeName, args, fcn, obj.username, obj.orgname);
	res.send(message);
});

//  Query Get Block by BlockNumber
app.get('/channels/:channelName/blocks/:blockId', async function (req, res) {
	logger.debug('==================== GET BLOCK BY NUMBER ==================');
	let blockId = req.params.blockId;
	let peer = req.query.peer;
	logger.debug('channelName : ' + req.params.channelName);
	logger.debug('BlockID : ' + blockId);
	logger.debug('Peer : ' + peer);
	if (!blockId) {
		res.json(getErrorMessage('\'blockId\''));
		return;
	}

	let message = await query.getBlockByNumber(peer, req.params.channelName, blockId, req.username, req.orgname);
	res.send(message);
});

// Query Get Transaction by Transaction ID
app.get('/channels/:channelName/transactions/:trxnId', async function (req, res) {
	logger.debug('================ GET TRANSACTION BY TRANSACTION_ID ======================');
	logger.debug('channelName : ' + req.params.channelName);
	let trxnId = req.params.trxnId;
	let peer = req.query.peer;
	if (!trxnId) {
		res.json(getErrorMessage('\'trxnId\''));
		return;
	}

	let message = await query.getTransactionByID(peer, req.params.channelName, trxnId, req.username, req.orgname);
	res.send(message);
});
// Query Get Block by Hash
app.get('/channels/:channelName/blocks', async function (req, res) {
	logger.debug('================ GET BLOCK BY HASH ======================');
	logger.debug('channelName : ' + req.params.channelName);
	let hash = req.query.hash;
	let peer = req.query.peer;
	if (!hash) {
		res.json(getErrorMessage('\'hash\''));
		return;
	}

	let message = await query.getBlockByHash(peer, req.params.channelName, hash, req.username, req.orgname);
	res.send(message);
});
//Query for Channel Information
app.get('/channels/:channelName', async function (req, res) {
	logger.debug('================ GET CHANNEL INFORMATION ======================');
	logger.debug('channelName : ' + req.params.channelName);
	let peer = req.query.peer;

	let message = await query.getChainInfo(peer, req.params.channelName, req.username, req.orgname);
	res.send(message);
});
//Query for Channel instantiated chaincodes
app.get('/channels/:channelName/chaincodes', async function (req, res) {
	logger.debug('================ GET INSTANTIATED CHAINCODES ======================');
	logger.debug('channelName : ' + req.params.channelName);
	let peer = req.query.peer;

	let message = await query.getInstalledChaincodes(peer, req.params.channelName, 'instantiated', req.username, req.orgname);
	res.send(message);
});
// Query to fetch all Installed/instantiated chaincodes
app.get('/chaincodes', async function (req, res) {
	var peer = req.query.peer;
	var installType = req.query.type;
	logger.debug('================ GET INSTALLED CHAINCODES ======================');

	let message = await query.getInstalledChaincodes(peer, null, 'installed', req.username, req.orgname)
	res.send(message);
});
// Query to fetch channels
app.get('/channels', async function (req, res) {
	logger.debug('================ GET CHANNELS ======================');
	logger.debug('peer: ' + req.query.peer);
	var peer = req.query.peer;
	if (!peer) {
		res.json(getErrorMessage('\'peer\''));
		return;
	}

	let message = await query.getChannels(peer, req.username, req.orgname);
	res.send(message);
});

module.exports = app
