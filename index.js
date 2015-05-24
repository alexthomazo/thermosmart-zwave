var OpenZWave = require('openzwave'),
	mqtt = require('mqtt');

// ----------------------------------------------------------------------------------
// --------------                 Z-WAVE PART                  ----------------------
// ----------------------------------------------------------------------------------
var zwave = new OpenZWave('/dev/ttyUSB0', { saveconfig: true });
var zwaveConnected = false;
var nodes = {};
var mqtt_values = {};

zwave.on('driver ready', function(homeid) {
	console.log('scanning homeid=0x%s...', homeid.toString(16));
});

zwave.on('driver failed', function() {
	console.log('failed to start driver');
	zwave.disconnect();
	process.exit();
});

zwave.on('node added', function(nodeid) {
	nodes[nodeid] = {
		manufacturer: '',
		manufacturerid: '',
		product: '',
		producttype: '',
		productid: '',
		type: '',
		name: '',
		loc: '',
		classes: {},
		ready: false
	};
});

zwave.on('value added', function(nodeid, comclass, value) {
	if (!nodes[nodeid]['classes'][comclass]) {
		nodes[nodeid]['classes'][comclass] = {};
	}

	if (!nodes[nodeid]['classes'][comclass][value.instance]) {
		nodes[nodeid]['classes'][comclass][value.instance] = {};
	}

	nodes[nodeid]['classes'][comclass][value.instance][value.index] = value;

	if (nodes[nodeid] && nodes[nodeid]['ready'] && comclass == 37) {
		//switch value changed
		updateSwitchValue(nodeid, value.instance, value['value']);
	}
});

zwave.on('value changed', function(nodeid, comclass, value) {
	if (nodes[nodeid]['ready']) {
		console.log('node%d: changed: Class %d - Instance %d: %s: %s -> %s', nodeid, comclass, value.instance,
			value['label'],
			nodes[nodeid]['classes'][comclass][value.instance][value.index]['value'],
			value['value']);
	}
	nodes[nodeid]['classes'][comclass][value.instance][value.index] = value;

	if (nodes[nodeid] && nodes[nodeid]['ready'] && comclass == 37) {
		//switch value changed
		updateSwitchValue(nodeid, value.instance, value['value']);
	}
});

zwave.on('value removed', function(nodeid, instance, comclass, index) {
	if (nodes[nodeid]['classes'][comclass]
		&& nodes[nodeid]['classes'][comclass][instance]
		&& nodes[nodeid]['classes'][comclass][instance][index]) {

		delete nodes[nodeid]['classes'][comclass][instance][index];
	}

	if (comclass == 37) {
		//switch value changed
		updateSwitchValue(nodeid, instance, "del");
	}
});

zwave.on('node ready', function(nodeid, nodeinfo) {
	var oldReady = nodes[nodeid]['ready'];

	nodes[nodeid]['manufacturer'] = nodeinfo.manufacturer;
	nodes[nodeid]['manufacturerid'] = nodeinfo.manufacturerid;
	nodes[nodeid]['product'] = nodeinfo.product;
	nodes[nodeid]['producttype'] = nodeinfo.producttype;
	nodes[nodeid]['productid'] = nodeinfo.productid;
	nodes[nodeid]['type'] = nodeinfo.type;
	nodes[nodeid]['name'] = nodeinfo.name;
	nodes[nodeid]['loc'] = nodeinfo.loc;
	nodes[nodeid]['ready'] = true;

	console.log('node%d: %s, %s', nodeid,
		nodeinfo.manufacturer ? nodeinfo.manufacturer : 'id=' + nodeinfo.manufacturerid,
		nodeinfo.product ? nodeinfo.product : 'product=' + nodeinfo.productid + ', type=' + nodeinfo.producttype);

	console.log('node%d: name="%s", type="%s", location="%s"', nodeid, nodeinfo.name, nodeinfo.type, nodeinfo.loc);

	var classes = nodes[nodeid]['classes'];

	Object.keys(classes).forEach(function(classId) {
		var instances = classes[classId];

		switch (classId) {
			case 0x25: // COMMAND_CLASS_SWITCH_BINARY
			case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
				zwave.enablePoll(nodeid, classId);
		}
		console.log('node%d: class %d', nodeid, classId);

		Object.keys(instances).forEach(function(instance) {
			var values = instances[instance];
			console.log('node%d:  instance %d', nodeid, instance);

			Object.keys(values).forEach(function(index) {
				var value = values[index];
				console.log('node%d:   (%d) %s=%s', nodeid, index, value['label'], value['value']);

				if (classId == 37 && !oldReady) {
					//switch option only if not already init
					updateSwitchValue(nodeid, instance, value['value']);
				}
			});
		});
	});
});

zwave.on('notification', function(nodeid, notif) {
	switch (notif) {
		case 0:
			console.log('node%d: message complete', nodeid);
			break;
		case 1:
			console.log('node%d: timeout', nodeid);
			break;
		case 2:
			console.log('node%d: nop', nodeid);
			break;
		case 3:
			console.log('node%d: node awake', nodeid);
			break;
		case 4:
			console.log('node%d: node sleep', nodeid);
			break;
		case 5:
			console.log('node%d: node dead', nodeid);
			break;
		case 6:
			console.log('node%d: node alive', nodeid);
			break;
	}
});

zwave.on('scan complete', function() {
	zwaveConnected = true;
	console.log('scan complete, hit ^C to finish.');
});


// ----------------------------------------------------------------------------------
// --------------                  MQTT PART                   ----------------------
// ----------------------------------------------------------------------------------
var client  = mqtt.connect('mqtt://localhost');
var mqtt_base_topic = 'thermosmart/zwave/';
var re = new RegExp('([^/]+)/?');

client.on('message', function (topic, message) {
	//topic from : thermosmart/zwave/<nodeid>/<instance>/(value|set)

	var msg = JSON.parse(message.toString());
	var id = topic.split(re);
	var node = id[5];
	var instance = id[7];
	var cmd = id[9];

	if (cmd == "value") {
		//persisted message of value
		if (!mqtt_values[node]) {
			mqtt_values[node] = {};
		}

		mqtt_values[node][instance] = msg.v;

	} else if (cmd == "set" && zwaveConnected) {
		//someone asks us to set switch value
		if (msg.v == "on") {
			zwave.switchOn(node, instance);
		} else {
			zwave.switchOff(node, instance);
		}
	}
});

function updateSwitchValue(node, instance, value) {
	var cur;
	if (mqtt_values[node]) {
		cur = mqtt_values[node][instance] == "on";
	}

	var msg;
	if (value == "del") {
		//delete retained message
		msg = null;

	} else if (value != cur) {
		//update message
		msg = JSON.stringify({
			v: value ? "on" : "off",
			d: new Date().toISOString()
		});
	}

	if (msg !== undefined) {
		client.publish(mqtt_base_topic + node + '/' + instance + '/value', msg, { retain: true });
	}
}

client.on('connect', function () {
	console.log("MQTT Connected");
	monitor();

	//read previous state persisted into mqtt broker
	client.subscribe(mqtt_base_topic + '#');

	//wait a little bit to read persisted messages
	setTimeout(function() {
		zwave.connect();
	}, 1000);
});

function monitor() {
	//publish each 30s that the server is still alive
	client.publish("thermosmart/monitor/zwave", JSON.stringify(new Date().toISOString()), { retain: true });
	setTimeout(monitor, 30000);
}

// ----------------------------------------------------------------------------------
// --------------                 GLOBAL PART                  ----------------------
// ----------------------------------------------------------------------------------

process.on('SIGINT', function() {
	console.log('disconnecting...');
	if (zwave && zwaveConnected) {
		zwave.disconnect();
	}

	if (client) {
		client.end();
	}

	process.exit();
});