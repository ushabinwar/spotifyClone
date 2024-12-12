var express = require('express');
var router = express.Router();
var users = require('../models/userModel')
var sonModel = require('../models/songModel')
var playlistModel = require('../models/playlistModel')
var passport = require('passport')
// var localStrategy = require('passport-local')
var multer = require('multer')
var id3 = require('node-id3')
var crypto = require('crypto')
const mongoose = require('mongoose');
const { Readable } = require('stream');
const songModel = require('../models/songModel');
const userModel = require('../models/userModel');
const localStrategy = require('passport-local').Strategy; // Import the Strategy class
passport.use(new localStrategy(users.authenticate()));

let gfsBucket;
let gfsBucketPoster;

mongoose.connect('mongodb+srv://akshu:akshux3@spoti1.qjhp0lh.mongodb.net/spotiakss?retryWrites=true&w=majority').then(() => {
  console.log('connected to database')
}).catch(err => {
  console.log(err)
})

const conn = mongoose.connection

conn.once('open', () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'audio'
  });
  gfsBucketPoster = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'poster'
  });
});


/* GET home page. */
router.get('/', isloggedIn, async function (req, res, next) {
  try {
    const currentUser = await userModel
      .findById(req.user._id)
      .populate({
        path: 'playlist',
        populate: {
          path: 'songs',
          model: 'song'
        }
      });

    // Filter playlists to only include the ones owned by the current user
    const playlists = currentUser.playlist.filter(playlist => playlist.owner.equals(currentUser._id));

    res.render('index', { playlists, currentUser });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching playlists');
  }
});


/* user authentication routes */

router.post('/register', async (req, res, next) => {
  try {
    const newUser = {
      username: req.body.username,
      email: req.body.email,
      isAdmin: false // Assuming you have an isAdmin field in your userModel
    };

    const result = await users.register(newUser, req.body.password);

    // Authenticate the user
    passport.authenticate('local')(req, res, async () => {
      const songs = await songModel.find();

      // Create a default playlist with 20 random songs
      const randomSongs = getRandomSongs(songs, 20);
      const defaultPlaylist = await playlistModel.create({
        name: "Default playlist",
        owner: req.user._id,
        songs: randomSongs.map(song => song._id)
      });

      // Add default playlist to the user
      const updatedUser = await userModel.findByIdAndUpdate(
        req.user._id,
        { $push: { playlist: defaultPlaylist._id } },
        { new: true }
      );

      // Populate user's playlists with songs
      const currentUser = await userModel
        .findById(req.user._id)
        .populate({
          path: 'playlist',
          populate: {
            path: 'songs',
            model: 'song'
          }
        });

      res.redirect('/');
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error registering user');
  }
});

function getRandomSongs(songs, count) {
  const randomSongs = [];
  const shuffledSongs = songs.sort(() => Math.random() - 0.5);
  for (let i = 0; i < count; i++) {
    randomSongs.push(shuffledSongs[i]);
  }
  return randomSongs;
}




router.get('/auth', (req, res, next) => {
  res.render('register')
})
router.post('/login',
  passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/auth',
  }),
  (req, res, next) => { }
);

router.get('/logout', (req, res, next) => {
  if (req.isAuthenticated())
    req.logout((err) => {
      if (err) res.send(err);
      else res.redirect('/');
    });
  else {
    res.redirect('/auth');
  }
});

function isloggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  else res.redirect('/auth');
}

/* user authentication routes */

const storage = multer.memoryStorage()
const upload = multer({ storage: storage })
router.post('/uploadMusic',isloggedIn,isAdmin, upload.array('song'), async (req, res, next) => {
  try {

    await Promise.all(req.files.map(async file=>{
      const randomName = crypto.randomBytes(20).toString('hex');

      const songData = id3.read(file.buffer);
  
      // Upload song and poster
      Readable.from(file.buffer).pipe(gfsBucket.openUploadStream(randomName));
      Readable.from(songData.image.imageBuffer).pipe(gfsBucketPoster.openUploadStream(randomName + "poster"));
  
      // Create song document
      await songModel.create({
        title: songData.title,
        artist: songData.artist,
        album: songData.album,
        size: file.size,
        poster: randomName + "poster",
        filename: randomName
      });
  
    }))
    
    res.send('Songs uploaded successfully');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading song');
  }
});

router.get('/uploadMusic',isloggedIn,isAdmin,(req,res,next)=>{
  res.render('uploadmusic')
})
router.get('/poster/:posterName',(req,res,next)=>{
  gfsBucketPoster.openDownloadStreamByName(req.params.posterName).pipe(res)
})

router.get('/stream/:musicName', async (req, res, next) => {
  const currentSong = await songModel.findOne({
    filename: req.params.musicName
  })

  const stream = gfsBucket.openDownloadStreamByName(req.params.musicName)

  res.set('Content-Type', 'audio/mpeg')
  res.set('Content-Length', currentSong.size + 1)
  res.set('Content-Range', `bytes 0-${currentSong.size - 1}/${currentSong.size}`)
  res.set('Content-Ranges', 'byte')
  res.status(206)

  stream.pipe(res)

})


function isAdmin(req,res,next){
  if(req.user.isAdmin) return next();
  else return res.redirect('/')
}

router.get('/search',(req,res,next)=>{
  res.render('search')
})

router.post('/search', async (req, res, next) => {
  

  const searhedMusic = await songModel.find({
    title: { $regex: req.body.search }
  })

  res.json({
    songs: searhedMusic
  })

})

router.post('/like/:songId', isloggedIn, async (req, res, next) => {
  try {
    const { songId } = req.params;

    // Find the current user
    const currentUser = await userModel.findById(req.user._id);

    // Check if the user has already liked the song
    const alreadyLiked = currentUser.likes.includes(songId);

    if (alreadyLiked) {
      // If already liked, remove the song from likes
      currentUser.likes = currentUser.likes.filter(id => id.toString() !== songId);
    } else {
      // If not liked, add the song to likes
      currentUser.likes.push(songId);
    }

    await currentUser.save();

    res.redirect('back');
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error liking/unliking song' });
  }
});

router.get('/liked', isloggedIn, async (req, res, next) => {
  try {
    const currentUser = await userModel.findById(req.user._id).populate('likes');
    res.render('liked', { likedSongs: currentUser.likes ,currentUser});
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching liked songs');
  }
});

router.get('/playlist',(req,res,next)=>{
  res.render('playlist')
})
// Add a route for creating playlists
router.post('/createplaylist', isloggedIn, async (req, res, next) => {
  try {
    const currentUser = await userModel.findById(req.user._id);

    const newPlaylist = await playlistModel.create({
      name:req.body.name,
      owner: req.user._id,
    });
    
    console.log(currentUser.playlist)
    currentUser.playlist.push(newPlaylist._id);
    await currentUser.save();

    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error creating playlist');
  }
});

router.get('/playlists', isloggedIn, async (req, res, next) => {
  try {
    const currentUser = await userModel
      .findById(req.user._id)
      .populate({
        path: 'playlist',
        populate: {
          path: 'songs',
          model: 'song',
        },
      });

    res.render('playlists', { playlists: currentUser.playlist });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching playlists');
  }
});

router.get('/playlist/:playlistId', isloggedIn, async (req, res, next) => {
  try {
    const { playlistId } = req.params;
    const playlist = await playlistModel
      .findById(playlistId)
      .populate('songs');
    res.render('playlistDetail', { playlist : playlist });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching playlist');
  }
});

// Route for adding a song to the current playlist
router.post('/playlist/:playlistId/addsong/:songId', isloggedIn, async (req, res, next) => {
  try {
    const { playlistId, songId } = req.params;
    const playlist = await playlistModel.findById(playlistId);
    playlist.songs.push(songId);
    await playlist.save();
    res.redirect(`/playlist/${playlistId}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error adding song to playlist');
  }
});


// Add this route to your server file (e.g., routes/index.js)

router.post('/playlist/:playlistId/removesong/:songId', isloggedIn, async (req, res, next) => {
  try {
    const { playlistId, songId } = req.params;

    const playlist = await playlistModel.findById(playlistId);

    // Remove the song from the playlist
    playlist.songs = playlist.songs.filter(song => !song.equals(songId));
    await playlist.save();

    res.redirect(`/playlist/${playlistId}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error removing song from playlist');
  }
});

router.get('/currentPlayingSong', (req, res) => {
  const currentSong = req.session.currentSong || { title: 'No Song Playing', artist: '' };
  res.json(currentSong);
});

// playlist delete
router.post('/playlist/:playlistId/delete', isloggedIn, async (req, res, next) => {
  try {
    const { playlistId } = req.params;

    // Find the playlist by ID
    const playlist = await playlistModel.findById(playlistId);

    if (!playlist) {
      return res.status(404).send('Playlist not found');
    }

    // Check if the current user is the owner of the playlist
    if (!playlist.owner.equals(req.user._id)) {
      return res.status(403).send('Access denied');
    }

    // Remove the playlist
    await playlistModel.findByIdAndDelete(playlistId);

    // Remove the playlist ID from the user's playlists
    const currentUser = await userModel.findByIdAndUpdate(
      req.user._id,
      { $pull: { playlist: playlistId } },
      { new: true }
    );

    res.redirect('/'); // Redirect to the playlists page or another appropriate route
  } catch (error) {
    console.error(error);
    res.status(500).send('Error deleting playlist');
  }
});



module.exports = router;

