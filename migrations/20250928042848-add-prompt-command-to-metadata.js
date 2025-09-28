'use strict';

var dbm;
var type;
var seed;

/**
  * We receive the dbmigrate dependency an imports from it in this function.
  * Then we can use with confidence.
  */
exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

/**
  * Migrations, tells what to do
  */
exports.up = function(db, callback) {
  db.addColumn('message_metadata', 'prompt_command', {
    type: 'text'
  }, function(err) {
    if (err) return callback(err);
    return callback();
  });
};

/**
  *
  *  Tells what to do to revert the migration
  */
exports.down = function(db, callback) {
  db.removeColumn('message_metadata', 'prompt_command', function(err) {
    if (err) return callback(err);
    return callback();
  });
};

exports._meta = {
  "version": 1
};