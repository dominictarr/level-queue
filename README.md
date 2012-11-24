# level-queue

queue plugin for leveldb.

This module can be used to add job queues to leveldb,
and is especially useful if used with [level-hooks](https://github.com/dominictarr/level-hooks)

## Example

``` js
var levelup = require('levelup')

levelup(file, function(err, db) {

  //adds .queue to db.
  require('level-queue')()(db)

  //add a worker, for a given job name.
  db.queue.add('job', function (value, done) {

    setTimeout(function () {
      console.log(value)
      //call done() to delete this job from the database.
      done()
    }, Math.random() * 1000)

  })

  db.queue('job', 'todo - may be any string or buffer')
  
})

```

If the process crashes before the job is completed, 
it will be restarted when the process restarts.

The job *must* be idempotent.


## Example with hooks

make a twitter like news feed, 
where messages are posted to friend's feeds.

``` js
var levelup = require('levelup')
var map     = require('map-stream')

levelup(file, function(err, db) {


  //adds .queue to db.
  require('level-hooks')()(db)
  require('level-queue')()(db)

  //add a worker, for a given job name.
  db.queue.add('job', function (value, done) {

    setTimeout(function () {
      console.log(value)
      //call done() to delete this job from the database.
      done()
    }, Math.random() * 1000)

  })

  /**

    calling db.queue(name, value, false)

    will not PUT the queue into the database, but will instead return the insert
    so that it can be included into an atomic batch operation.

  **/

  db.hooks.pre(function (batch) {
    //if any of the inserts is a user 
    
    for(var i in batch) {
      var row = batch[i]
      if(isUserMessage(row.key))
        batch.push(db.queue('postToFriends', row.value, false))
    }
  })

  db.queue.add('postToFriends', function (value, done) {
    var message = JSON.parse(''+value)

    //retrive all friends of a poster.
    db.readStream({
      start: 'friends:'+message.author, 
      end: 'friends:'+message.author + '~'
    })
    //attach the message to all follower's feeds.
    .pipe(map(function (val, next) {
      db.put('feed:'+val+':'
        +message.timestamp()+':'
        +message.author, value, next)
      //note: since we take the timestamp from the message,
      //if the job accidentially gets run twice,
      //it will just overwrite the same message.
      //the job is idempotent!
    })
    //mark the job DONE!
    .on('end', done)
  })
  
})

```


## License

MIT
