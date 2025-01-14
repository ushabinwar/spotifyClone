const mongoose = require("mongoose");

const playlistSchema = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    owner: {
        type:
            mongoose.Schema.Types.ObjectId,
           required: true
     },
     poster:{
        type:String,
        default:'/images/default/defmusic.png'
     },
     songs:[
        {
            type:mongoose.Schema.Types.ObjectId,
            ref:'song'
        }
     ]
})

module.exports = mongoose.model('playlist',playlistSchema);