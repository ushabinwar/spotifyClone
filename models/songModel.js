const mongoose = require("mongoose");

const songSchema = mongoose.Schema({
    title:String,
    artist:String,
    album:String,
    category:[
        {
            type:String,
            enum:['pinjabi','gujarti']
        }
    ],
    likes:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    size:Number,
    poster:String,
    filename:{
        type:String,
        required:true
    }
})

module.exports = mongoose.model('song',songSchema);