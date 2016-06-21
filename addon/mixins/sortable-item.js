import Ember from 'ember';
import computed from 'ember-new-computed';
const { Mixin, $, run } = Ember;
const { Promise } = Ember.RSVP;

export default Mixin.create({
  classNames: ['sortable-item'],
  classNameBindings: ['isDragging', 'isDropping', 'isLastNew:is-last-new', 'isFirstNew:is-first-new', 'insertHighlight:insert-highlight'],

  insertHighlight: false,

  /**
    Group to which the item belongs.
    @property group
    @type SortableGroup
    @default null
  */
  group: null,

  /**
    Model which the item represents.
    @property model
    @type Object
    @default null
  */
  model: null,

  /**
    Selector for the element to use as handle.
    If unset, the entire element will be used as the handle.
    @property handle
    @type String
    @default null
  */
  handle: null,

  /**
    True if the item is currently being dragged.
    @property isDragging
    @type Boolean
    @default false
  */
  isDragging: false,

  /**
    Action that fires when the item starts being dragged.
    @property onDragStart
    @type Action
    @default null
  */
  onDragStart: null,

  /**
    Action that fires when the item stops being dragged.
    @property onDragStop
    @type Action
    @default null
  */
  onDragStop: null,

  /**
    True if the item is currently dropping.
    @property isDropping
    @type Boolean
    @default false
  */
  isDropping: false,

  //
  // These are a temporary fix until we can have external drop targets.
  // If you are dropping 200px above the list, we assume its an external
  // target and turn off the drop animation (which appear like the item is
  // flying back into the list even though it's actually being removed.
  //
  _dragY: null,
  isAboveTheFold: function() {
    let isDropping = this.get('isDropping');
    let wasDropped = this.get('wasDropped');
    let relativeY = this.get('_dragY');

    return ( (isDropping || wasDropped) && (relativeY < 200));

  }.property('isDropping', 'wasDropped', '_dragY'),

  /**
    True if this item is the last new item. Allows styling the last new item
    in the set differently.
    @property isLastNew
    @type Boolean
    @default false
  */
  isLastNew: computed.alias('model.isLastNew'),

  /**
    True if this item is the first new item. Allows styling the first new item
    in the set differently.
    @property isLastNew
    @type Boolean
    @default false
  */

  isFirstNew: computed.alias('model.isFirstNew'),

  /**
    True if the item was dropped during the interaction
    @property wasDropped
    @type Boolean
    @default false
  */
  wasDropped: false,


  /**
    @property isBusy
    @type Boolean
  */
  isBusy: computed.or('isDragging', 'isDropping'),

  /**
    The frequency with which the group is informed
    that an update is required.
    @property updateInterval
    @type Number
    @default 125
  */
  updateInterval: 125,

  /**
    True if the item transitions with animation.
    @property isAnimated
    @type Boolean
  */
  isAnimated: computed(function() {
    let el = this.$();
    let property = el.css('transition-property');

    return /all|transform/.test(property);
  }).volatile(),

  /**
    The current transition duration in milliseconds.
    @property transitionDuration
    @type Number
  */
  transitionDuration: computed(function() {
    let el = this.$();
    let rule = el.css('transition-duration');
    let match = rule.match(/([\d\.]+)([ms]*)/);

    if (match) {
      let value = parseFloat(match[1]);
      let unit = match[2];

      if (unit === 's') {
        value = value * 1000;
      }

      return value;
    }

    return 0;
  }).volatile(),

  /**
    Horizontal position of the item.
    @property x
    @type Number
  */
  x: computed({
    get() {
      if (this._x === undefined) {
        let marginLeft = parseFloat(this.$().css('margin-left'));
        this._x = this.element.scrollLeft + this.element.offsetLeft - marginLeft;
      }

      return this._x;
    },
    set(_, value) {
      if (value !== this._x) {
        this._x = value;
        this._scheduleApplyPosition();
      }
    },
  }).volatile(),

  /**
    Vertical position of the item relative to its offset parent.
    @property y
    @type Number
  */
  y: computed({
    get() {
      if (this._y === undefined) {
        this._y = this.element.offsetTop;
      }

      return this._y;
    },
    set(key, value) {
      if (value !== this._y) {
        this._y = value;
        this._scheduleApplyPosition();
      }
    }
  }).volatile(),

  _myBox: function() {
    let el = this.$();
    let width = el.outerWidth(true);
    let height = el.outerHeight(true);
    let offset = el.offset();

    return [
      {
        x: offset.left,
        y: offset.top
      },
      {
        x: offset.left + width,
        y: offset.top + height
      }
    ];

  }.property().volatile(),

  _isOnMe: function(dragX, dragY) {
    let myBox = this.get("_myBox");

    if (dragX > myBox[0].x && dragX < myBox[1].x &&
        dragY > myBox[0].y && dragY < myBox[1].y) {

      return true;
    }

    return false;
  },


  /**
    Width of the item.
    @property height
    @type Number
  */
  width: computed(function() {
    let el = this.$();
    let width = 0;

    if (el) {
      width = el.outerWidth(true);

      width += getBorderSpacing(el).horizontal;
    }

    return width;
  }).volatile(),

  /**
    Height of the item including margins.
    @property height
    @type Number
  */
  height: computed(function() {
    let el = this.$();
    let height = 0;

    if (el) {
      height = el.outerHeight();

      let marginBottom = parseFloat(el.css('margin-bottom'));
      height += marginBottom;

      height += getBorderSpacing(el).vertical;
    }

    return height;
  }).volatile(),

  /**
    @method didInsertElement
  */
  didInsertElement() {
    this._super();
    // scheduled to prevent deprecation warning:
    // "never change properties on components, services or models during didInsertElement because it causes significant performance degradation"
    run.schedule("afterRender", this, "_tellGroup", "registerItem", this);
  },

  /**
    @method willDestroyElement
  */
  willDestroyElement() {
    // scheduled to prevent deprecation warning:
    // "never change properties on components, services or models during didInsertElement because it causes significant performance degradation"
    run.schedule("afterRender", this, "_tellGroup", "deregisterItem", this);
  },

  /**
    @method mouseDown
  */
  mouseDown(event) {

    if (event.which !== 1) { return; }
    if (event.ctrlKey) { return; }

    let longPress = true;

    function cancelLongPress() {
      longPress = false;
    }

    Ember.run.next( () => {
      if (longPress) {
        longPress = false;
        this._primeDrag(event);
      }

      $(window).off("mousemove mouseup", cancelLongPress);
    });

    this.set("isDragging", false);
    this.set("isDropping", false);
    $(window).on("mousemove mouseup", cancelLongPress);
  },

  /**
    @method touchStart
  */
  touchStart(event) {
    let longPress = true;

    function cancelLongPress() {
      longPress = false;
    }

    Ember.run.next( () => {
      if (longPress) {
        this._primeDrag(event);
      }

      $(window).off("touchmove touchend", cancelLongPress);
    });

    this.set("isDragging", false);
    this.set("isDropping", false);
    $(window).on("touchmove touchend", cancelLongPress);
  },

  /**
    @method freeze
  */
  freeze() {
    let el = this.$();
    if (!el) { return; }

    el.css({ transition: 'none' });
    el.height(); // Force-apply styles
  },

  /**
    @method reset
  */
  reset() {
    let el = this.$();
    if (!el) { return; }

    delete this._y;
    delete this._x;

    el.css({ transform: '' });
    el.height(); // Force-apply styles
  },

  /**
    @method thaw
  */
  thaw() {
    let el = this.$();
    if (!el) { return; }

    el.css({ transition: '' });
    el.height(); // Force-apply styles
  },

  /**
    @method _primeDrag
    @private
  */
  _primeDrag(event) {
    let handle = this.get('handle');

    if (handle && !$(event.target).closest(handle).length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    let startDragListener = event => this._startDrag(event);

    function cancelStartDragListener() {
      $(window).off('mousemove touchmove', startDragListener);
    }

    $(window).one('mousemove touchmove', startDragListener);
    $(window).one('mouseup touchend', cancelStartDragListener);
  },

  /**
    @method _startDrag
    @private
  */
  _startDrag(event) {
    if (this.get('isBusy')) { return; }
    if (!this.$()) { return; }

    let drag = this._makeDragHandler(event);

    let drop = () => {
      $(window)
        .off('mousemove touchmove', drag)
        .off('mouseup touchend', drop);

      this._drop();
    };

    $(window)
      .on('mousemove touchmove', drag)
      .on('mouseup touchend', drop);

    this._tellGroup('prepare');
    this.set('isDragging', true);
    this.sendAction('onDragStart', this.get('model'));
  },

  /**
    @method _makeDragHandler
    @param {Event} startEvent
    @return {Function}
    @private
  */
  _makeDragHandler(startEvent) {
    const groupDirection = this.get('group.direction');
    const constrainDirection = this.get('group.constrainDirection');

    let dragOriginX, dragOriginY;
    let elementOriginX, elementOriginY;
    let scrollOriginX, scrollOriginY;
    let parentElement = $(this.element.parentNode);

    if (constrainDirection) {

      if (groupDirection === 'x') {
        dragOriginX = getX(startEvent);
        elementOriginX = this.get('x');
        scrollOriginX = parentElement.offset().left;

        return event => {
          let dx = getX(event) - dragOriginX;
          let scrollX = parentElement.offset().left;
          let x = elementOriginX + dx + (scrollOriginX - scrollX);

          this._drag(x);
        };
      }

      if (groupDirection === 'y') {
        dragOriginY = getY(startEvent);
        elementOriginY = this.get('y');
        scrollOriginY = parentElement.offset().top;

        return event => {
          let dy = getY(event) - dragOriginY;
          let scrollY = parentElement.offset().top;
          let y = elementOriginY + dy + (scrollOriginY - scrollY);

          this._drag(y);
        };
      }
    } else {

      dragOriginX = getX(startEvent);
      dragOriginY = getY(startEvent);
      elementOriginX = this.get('x');
      elementOriginY = this.get('y');
      scrollOriginX = parentElement.offset().left;
      scrollOriginY = parentElement.offset().top;

      return event => {
        let pageX = getX(event);
        let pageY = getY(event);
        let dx = pageX - dragOriginX;
        let dy = pageY - dragOriginY;
        let scrollX = parentElement.offset().left;
        let scrollY = parentElement.offset().top;
        let x = elementOriginX + dx + (scrollOriginX - scrollX);
        let y = elementOriginY + dy + (scrollOriginY - scrollY);

        this._drag(x, y, pageX, pageY);
      };
    }
  },

  /**
    @method _tellGroup
    @private
  */
  _tellGroup(method, ...args) {
    let group = this.get('group');

    if (group) {
      group[method](...args);
    }
  },

  _sendDrag(position) {
    this.sendAction("onDrag", position);
  },

  /**
    @method _scheduleApplyPosition
    @private
  */
  _scheduleApplyPosition() {
    run.scheduleOnce('render', this, '_applyPosition');
  },

  /**
    @method _applyPosition
    @private
  */
  _applyPosition() {
    if (!this.element) { return; }

    const groupDirection = this.get('group.direction');
    const constrainDirection = this.get('group.constrainDirection');

    if (constrainDirection) {

      if (groupDirection === 'x') {
        let x = this.get('x');
        let dx = x - this.element.offsetLeft + parseFloat(this.$().css('margin-left'));

        this.$().css({
          transform: `translateX(${dx}px)`
        });
      }
      if (groupDirection === 'y') {
        let y = this.get('y');
        let dy = y - this.element.offsetTop;

        this.$().css({
          transform: `translateY(${dy}px)`
        });
      }
    } else {
      let x = this.get('x');
      let dx = x - this.element.offsetLeft + parseFloat(this.$().css('margin-left'));
      let y = this.get('y');
      let dy = y - this.element.offsetTop;

      this.$().css({
        transform: `translateX(${dx}px) translateY(${dy}px)`
      });
    }
  },

  /**
    @method _drag
    @private
  */
  _drag(dimension, secondaryDimension, pageX, pageY) {
    let updateInterval = this.get('updateInterval');
    const groupDirection = this.get('group.direction');
    const constrainDirection = this.get('group.constrainDirection');

    if (constrainDirection) {

      if (groupDirection === 'x') {
        this.set('x', dimension);
      }
      if (groupDirection === 'y') {
        this.set('y', dimension);
      }
    } else {
      this.set('x', dimension);
      this.set('y', secondaryDimension);
      this.set('_dragY', pageY);

      run.throttle(this, '_sendDrag', {x: pageX, y: pageY}, updateInterval);
    }

    run.throttle(this, '_tellGroup', 'update', {x: pageX, y: pageY}, updateInterval);
  },

  /**
    @method _drop
    @private
  */
  _drop() {
    if (!this.element) { return; }

    this._preventClick(this.element);

    this.set('isDragging', false);
    this.set('isDropping', true);

    this._tellGroup('update');

    // if out of bounds, turn off animations
    if (this.get('isAboveTheFold')) this.freeze();

    this._waitForTransition()
      .then(run.bind(this, '_complete'));
  },

  /**
    @method _preventClick
    @private
  */
  _preventClick(element) {
    $(element).one('click', function(e){ e.stopImmediatePropagation(); } );
  },

  /**
    @method _waitForTransition
    @private
    @return Promise
  */
  _waitForTransition() {
    return new Promise(resolve => {
      run.next(() => {
        let duration = 0;

        if (this.get('isAnimated')) {
          duration = this.get('transitionDuration');
        }

        run.later(this, resolve, duration);
      });
    });
  },

  /**
    @method _complete
    @private
  */
  _complete() {
    this.sendAction('onDragStop', this.get('model'));
    this.set('isDropping', false);
    this.set('wasDropped', true);
    this._tellGroup('commit');

    if (this.get('isAboveTheFold')) this.thaw();
  }
});

/**
  Gets the y offset for a given event.
  Work for touch and mouse events.
  @method getY
  @return {Number}
  @private
*/
function getY(event) {
  let originalEvent = event.originalEvent;
  let touches = originalEvent && originalEvent.changedTouches;
  let touch = touches && touches[0];

  if (touch) {
    return touch.screenY;
  } else {
    return event.pageY;
  }
}

/**
  Gets the x offset for a given event.
  @method getX
  @return {Number}
  @private
*/
function getX(event) {
  let originalEvent = event.originalEvent;
  let touches = originalEvent && originalEvent.changedTouches;
  let touch = touches && touches[0];

  if (touch) {
    return touch.screenX;
  } else {
    return event.pageX;
  }
}

/**
  Gets a numeric border-spacing values for a given element.

  @method getBorderSpacing
  @param {Element} element
  @return {Object}
  @private
*/
function getBorderSpacing(el) {
  el = $(el);

  let css = el.css('border-spacing'); // '0px 0px'
  let [horizontal, vertical] = css.split(' ');

  return {
    horizontal: parseFloat(horizontal),
    vertical: parseFloat(vertical)
  };
}
