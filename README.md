ThermoSmart Z-Wave
==================

Z-Wave part of ThermoSmart which handles communication between MQTT and Z-Wave switches.

Installation
------------

For now, the open-zwave gateway to Node JS is only compatible with version 0.10.x of NodeJS.
You can install Node with the following commands :
    
    wget http://node-arm.herokuapp.com/node_0.10.36_armhf.deb
    sudo dpkg -i node_0.10.36_armhf.deb
    

MQTT messages
-------------

Each time the state of switch is changing, the following message will be published to 
the topic `thermosmart/zwave/<nodeid>/<instance>/value` :

	{
		"v":"on",
		"d":"2015-05-24T16:48:03.240Z"
	}

The message will be retained by the MQTT broker so every time you subscribe to `thermosmart/zwave/+/+/value`,
you'll get the last value.
	
	
To change the state of a switch, you can send the following message to 
the topic `thermosmart/zwave/<nodeid>/<instance>/set` : 

	{
		"v":"off"
	}