/**
LevelUp Queue.
**/

var timestamp = require('monotonic-timestamp')
var hooks     = require('level-hooks')
var hash      = require('sha1sum')

module.exports = function (prefix, work) {

  return function (db, delay) {

    if(db.queue) {
      for(var job in work) {
        db.queue.add(job, work[job])
      }
      return
    }

    var jobs = [], pending = {}, batch = []

    if('string' !== typeof prefix)
      work = prefix, prefix = '~queue'
    if(!work) work = {}

    /**
    on start up, read any unfinished jobs from database 
    (incase there was a crash)

    cleanup any duplicates, 
    (possible if a delete fails and that job is requeued concurrently)

    then start the jobs.

    make i into a timestamp! a monotonic-timestamp
    **/

    var inProgress = 0
    var count = 0

    function emit(name, a, b) {
      if(!a)
        return db.emit('queue:' + name)
      db.emit('queue:'+name,    a, b)
      db.emit('queue:'+name+':'+a, b)
    }

    function onJob (data, recover) {
      //KEY should be VALUE
      var value = ''+data.value
      var ary = (''+data.key).split('~')
      var t   = ary.pop()
      var job = ary.pop()
      if(recover) emit('recover', job, value)
      start(job, t, value)
    }

    //read any jobs left from last run.
    db.readStream({start: prefix , end: prefix+'~~'})
      .on('data', function (data) {
        count=true; onJob(data, true)
      })
      .on('end', function () {
        //emit drain if there was no data.
        if(!count && !inProgress)
          db.emit('queue:drain')
      })

    //listen for new jobs.
    hooks()(db)
    db.hooks.post(function (change) {
        if(change.type == 'put' && /^~queue/.test(''+change.key)) {
          onJob(change)
        }
      })

    function toKey(job, ts) {
      return [prefix, job, (ts || timestamp()).toString()].join('~')
    }

    function start (job, ts, value) {
      if('function' !== typeof work[job]) {
        //log this error, but don't need to fail,
        //run this job next time.
        return (
            console.error || console.log
          )('level-queue has no work function for job:'+job)
      }
      inProgress ++
      setTimeout(function () {
        delete pending[hash(job+':'+value)]
        var n = 1
        function done () {
          if(--n) return
          db.del(toKey(job, ts), function () {
            inProgress --
            try {
              db.emit('queue:done', job, value)
              db.emit('queue:done:'+job, value)
            } finally {
              if(!inProgress)
                db.emit('queue:drain')
            }
          })
      
        }
        db.emit('queue:start', job, value, done)
        //you should probably just use this pattern...
        db.emit('queue:start:'+job, value, done)
        work[job](value, done)

      }, db.queue.delay)

    }
    //put=false means return a job to be queued

    function queue (job, value, put) {
      var ts = timestamp()
      var key = toKey(job, ts)

      var id = hash(job+':'+value)
      if(pending[id]) return null //this job is already queued.
      pending[id] = Date.now()

      if(put === false) {
        //return the job to be queued, to include it in a batch insert.
          return {
          type: 'put', 
          key: Buffer.isBuffer(key) ? key : new Buffer(key), 
          value: Buffer.isBuffer(key) ? value : new Buffer(value)
        }
      } else {
        db.put(key, value)
      }
    }

    //you should only add jobs in the first tick.
    queue.add = function (job, worker) {
      work[job] = worker
      return queue
    }

    db.queue = queue
    db.queue.delay = delay || 1000

    for(var job in work)
      db.queue.add(job, work[job])

  }
}
