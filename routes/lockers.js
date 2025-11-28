const express = require('express');
const router = express.Router();
const { auth, isAdmin, isEmployeeOrAdmin } = require('../middleware/auth');
const { openLocker, getLockerStatus } = require('../utils/lockerApi');

// Get all locker open events for the logged-in user
router.get('/open-events', auth, async (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  try {
    const [events] = await db.query(
      `SELECT e.id, e.locker_id, l.locker_number, e.opened_at
       FROM locker_open_events e
       JOIN lockers l ON e.locker_id = l.id
       WHERE e.user_id = ?
       ORDER BY e.opened_at DESC`,
      [userId]
    );
    res.json({ events });
  } catch (error) {
    console.error('Get locker open events error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all lockers
router.get('/', auth, async (req, res) => {
  const db = req.db;

  try {
    const [lockers] = await db.query(
      `SELECT l.*, u.name as user_name, u.role as user_role 
       FROM lockers l 
       LEFT JOIN users u ON l.current_user_id = u.id 
       ORDER BY l.locker_number`
    );

    // For each locker, get the hardware status
    const lockersWithStatus = await Promise.all(lockers.map(async (locker) => {
      try {
        const statusResult = await getLockerStatus(locker.locker_number);
        // Fallback parse to force open/closed if pattern exists
        let hw = statusResult && statusResult.status ? statusResult.status : 'unknown';
        const raw = (statusResult && (statusResult.rawResponse || statusResult.rawStatus || '')) || '';
        if (/Status=Open_\d+/.test(raw)) hw = 'open';
        if (/Status=Close_\d+/.test(raw)) hw = 'closed';
        return {
          ...locker,
          hardwareStatus: hw,
          rawResponse: statusResult && statusResult.rawResponse ? statusResult.rawResponse : null
        };
      } catch (error) {
        console.error(`Error getting status for locker ${locker.locker_number}:`, error);
        return {
          ...locker,
          hardwareStatus: 'unknown',
          error: error.message
        };
      }
    }));

    res.json({ lockers: lockersWithStatus });
  } catch (error) {
    console.error('Get lockers error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get locker by ID
router.get('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const db = req.db;

  try {
    const [lockers] = await db.query(
      `SELECT l.*, u.name as user_name, u.role as user_role 
       FROM lockers l 
       LEFT JOIN users u ON l.current_user_id = u.id 
       WHERE l.id = ?`,
      [id]
    );

    if (lockers.length === 0) {
      return res.status(404).json({ message: 'Locker not found' });
    }

    const locker = lockers[0];

    // Get hardware status
    const statusResult = await getLockerStatus(locker.locker_number);
    
    // Fallback parse to force open/closed if pattern exists
    let resolvedStatus = statusResult && statusResult.status ? statusResult.status : 'unknown';
    const raw = (statusResult && (statusResult.rawResponse || statusResult.rawStatus || '')) || '';
    if (/Status=Open_\d+/.test(raw)) resolvedStatus = 'open';
    if (/Status=Close_\d+/.test(raw)) resolvedStatus = 'closed';

    const lockerWithStatus = {
      ...locker,
      hardwareStatus: resolvedStatus,
      rawResponse: statusResult && statusResult.rawResponse ? statusResult.rawResponse : null
    };

    res.json({ locker: lockerWithStatus });
  } catch (error) {
    console.error('Get locker error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Open a locker (trigger hardware, log event immediately, never fail response due to hardware)
router.put('/:id/open', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const db = req.db;

  let lockerNumber = null;
  try {
    const [rows] = await db.query('SELECT locker_number FROM lockers WHERE id = ?', [id]);
    if (rows.length > 0) {
      lockerNumber = rows[0].locker_number;
    }
  } catch (e) {
    console.error('Failed to fetch locker number for hardware open:', e);
  }

  // Fire-and-forget hardware open (do not block or fail response)
  if (lockerNumber !== null && lockerNumber !== undefined) {
    (async () => {
      try {
        console.log(`Triggering hardware open for locker number: ${lockerNumber}`);
        const result = await openLocker(lockerNumber);
        console.log('Hardware open result (non-blocking):', result);
      } catch (hwErr) {
        console.error('Hardware open error (ignored for response):', hwErr);
      }
    })();
  } else {
    console.warn('Locker number not found; skipping hardware open');
  }

  // Log open event immediately
  try {
    const logData = { user_id: userId, locker_id: id };
    console.log('Logging to locker_open_events:', logData);
    await db.query('INSERT INTO locker_open_events (user_id, locker_id, opened_at) VALUES (?, ?, NOW())', [userId, id]);
    console.log(`Logged locker open event for user ${userId}, locker ${id}`);
  } catch (eventError) {
    console.error('Failed to log locker open event:', eventError);
    return res.status(500).json({ message: 'Failed to log open event', error: eventError.message });
  }

  // Always succeed
  res.json({
    message: 'Locker open event logged successfully and hardware open triggered',
    lockerOpenEvent: {
      user_id: userId,
      locker_id: id,
      opened_at: new Date().toISOString(),
    },
  });
});

// Get locker status
router.get('/:id/status', auth, async (req, res) => {
  const { id } = req.params;
  const db = req.db;
  console.log(`Received request for locker status. ID: ${id}`);

  // Fetch locker from DB
  let locker;
  try {
    const [lockers] = await db.query('SELECT * FROM lockers WHERE id = ?', [id]);
    if (lockers.length === 0) {
      console.log(`Locker not found with ID: ${id}`);
      return res.status(404).json({ message: 'Locker not found' });
    }
    locker = lockers[0];
    console.log(`Found locker in database. Locker number: ${locker.locker_number}`);
  } catch (dbErr) {
    console.error('DB error fetching locker for status:', dbErr);
    return res.status(500).json({ message: 'Server error', error: dbErr.message });
  }

  // Get hardware status (non-fatal)
  console.log(`Requesting hardware status for locker number: ${locker.locker_number}`);
  let statusResult = { success: false, status: 'unknown', rawResponse: null };
  try {
    statusResult = await getLockerStatus(locker.locker_number);
  } catch (hwErr) {
    console.error('Hardware status error (non-fatal):', hwErr);
  }

  // Fallback parse to force open/closed if pattern exists
  let resolvedStatus = statusResult && statusResult.status ? statusResult.status : 'unknown';
  const raw = (statusResult && (statusResult.rawResponse || statusResult.rawStatus || '')) || '';
  if (/Status=Open_\d+/.test(raw)) resolvedStatus = 'open';
  if (/Status=Close_\d+/.test(raw)) resolvedStatus = 'closed';

  const response = {
    locker: {
      id: locker.id,
      lockerNumber: locker.locker_number,
      status: locker.status,
      isOpen: locker.is_open === 1,
      currentUserId: locker.current_user_id
    },
    hardwareStatus: resolvedStatus,
    rawResponse: statusResult && statusResult.rawResponse ? statusResult.rawResponse : null
  };

  console.log(`Sending successful response for locker ${locker.locker_number} status:`, response.hardwareStatus);
  return res.json(response);
});

// Allot a locker to the current user (without opening)
router.post('/:id/allot', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const db = req.db;

  try {
    const [lockers] = await db.query('SELECT * FROM lockers WHERE id = ?', [id]);
    if (lockers.length === 0) {
      return res.status(404).json({ message: 'Locker not found' });
    }

    const locker = lockers[0];
    if (locker.status === 'occupied' && locker.current_user_id && locker.current_user_id !== userId) {
      return res.status(409).json({ message: 'Locker already allotted to another user' });
    }

    // If another active transaction exists for this user, prevent multiple lockers
    const [activeForUser] = await db.query(
      'SELECT * FROM transactions WHERE user_id = ? AND status = "active"',
      [userId]
    );
    if (activeForUser.length > 0) {
      return res.status(409).json({ message: 'You already have an active locker' });
    }

    // Create a transaction but don't open the locker
    await db.query(
      'INSERT INTO transactions (user_id, locker_id, status) VALUES (?, ?, "active")',
      [userId, id]
    );

    await db.query(
      'UPDATE lockers SET current_user_id = ?, status = "occupied" WHERE id = ?',
      [userId, id]
    );

    const [updated] = await db.query('SELECT * FROM lockers WHERE id = ?', [id]);
    return res.json({
      message: 'Locker allotted successfully',
      locker: {
        id: updated[0].id,
        lockerNumber: updated[0].locker_number,
        status: updated[0].status,
        isOpen: updated[0].is_open === 1,
        currentUserId: updated[0].current_user_id
      }
    });
  } catch (error) {
    console.error('Allot locker error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Close a locker (logout for users)
router.put('/:id/close', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const db = req.db;
  
  console.log(`Received request to close locker ID: ${id} by user ID: ${userId}`);

  try {
    // Get locker details
    const [lockers] = await db.query('SELECT * FROM lockers WHERE id = ?', [id]);

    if (lockers.length === 0) {
      console.log(`Locker not found with ID: ${id}`);
      return res.status(404).json({ message: 'Locker not found' });
    }

    const locker = lockers[0];
    console.log(`Found locker in database. Locker number: ${locker.locker_number}`);

    // Check if user can close this locker
    if (userRole === 'user' && locker.current_user_id !== userId) {
      console.log(`User ${userId} does not have permission to close locker ${id}`);
      return res.status(403).json({ message: 'You do not have permission to close this locker' });
    }

    // For users, complete the transaction and release the locker
    if (userRole === 'user') {
      console.log(`Processing user ${userId} closing locker ${id}`);
      // Find active transaction
      const [activeTransactions] = await db.query(
        'SELECT * FROM transactions WHERE locker_id = ? AND user_id = ? AND status = "active"',
        [id, userId]
      );

      if (activeTransactions.length > 0) {
        const transaction = activeTransactions[0];
        
        // Calculate usage time in minutes
        const startTime = new Date(transaction.start_time);
        const endTime = new Date();
        const usageMinutes = Math.ceil((endTime - startTime) / (1000 * 60));
        
        // Calculate amount (example: $1 per minute)
        const amount = usageMinutes * 1.0;
        console.log(`Completing transaction ${transaction.id} with amount ${amount}`);
        
        // Complete transaction
        await db.query(
          'UPDATE transactions SET end_time = NOW(), amount = ?, status = "completed" WHERE id = ?',
          [amount, transaction.id]
        );
        
        // Release locker
        console.log(`Releasing locker ${id} in database`);
        await db.query(
          'UPDATE lockers SET current_user_id = NULL, status = "empty", is_open = FALSE WHERE id = ?',
          [id]
        );
      }
    } else {
      // For employees and admin, just update the is_open status
      console.log(`Admin/employee ${userId} closing locker ${id}`);
      await db.query(
        'UPDATE lockers SET is_open = FALSE WHERE id = ?',
        [id]
      );
    }

    // Get updated locker status
    console.log(`Getting hardware status for locker ${locker.locker_number}`);
    const statusResult = await getLockerStatus(locker.locker_number);
    console.log(`Hardware status result for locker ${locker.locker_number}:`, statusResult);
    
    // Get updated locker from database
    const [updatedLockers] = await db.query('SELECT * FROM lockers WHERE id = ?', [id]);
    
    const response = {
      message: 'Locker closed successfully',
      locker: {
        id: updatedLockers[0].id,
        lockerNumber: updatedLockers[0].locker_number,
        status: updatedLockers[0].status,
        isOpen: updatedLockers[0].is_open === 1,
        currentUserId: updatedLockers[0].current_user_id
      },
      hardwareStatus: statusResult && statusResult.status ? statusResult.status : 'unknown',
      rawResponse: statusResult && statusResult.rawResponse ? statusResult.rawResponse : null
    };
    
    console.log(`Sending successful response for closing locker ${locker.locker_number}`);
    res.json(response);
  } catch (error) {
    console.error('Close locker error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Release a locker (without completing transaction)
router.post('/:id/release', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const db = req.db;
  
  console.log(`Received request to release locker ID: ${id} by user ID: ${userId}`);

  try {
    // Get locker details
    const [lockers] = await db.query('SELECT * FROM lockers WHERE id = ?', [id]);

    if (lockers.length === 0) {
      console.log(`Locker not found with ID: ${id}`);
      return res.status(404).json({ message: 'Locker not found' });
    }

    const locker = lockers[0];
    console.log(`Found locker in database. Locker number: ${locker.locker_number}`);

    // Check if user can release this locker
    if (userRole === 'user' && locker.current_user_id !== userId && userRole !== 'admin' && userRole !== 'employee') {
      console.log(`User ${userId} does not have permission to release locker ${id}`);
      return res.status(403).json({ message: 'You do not have permission to release this locker' });
    }

    // Release the locker
    console.log(`Releasing locker ${id} in database`);
    await db.query(
      'UPDATE lockers SET current_user_id = NULL, status = "empty", is_open = FALSE WHERE id = ?',
      [id]
    );
    
    // Get updated locker from database
    const [updatedLockers] = await db.query('SELECT * FROM lockers WHERE id = ?', [id]);
    
    const response = {
      message: 'Locker released successfully',
      locker: {
        id: updatedLockers[0].id,
        lockerNumber: updatedLockers[0].locker_number,
        status: updatedLockers[0].status,
        isOpen: updatedLockers[0].is_open === 1,
        currentUserId: updatedLockers[0].current_user_id
      }
    };
    
    console.log(`Sending successful response for releasing locker ${locker.locker_number}`);
    res.json(response);
  } catch (error) {
    console.error('Release locker error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = router;