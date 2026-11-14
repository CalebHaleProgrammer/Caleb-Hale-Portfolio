import {clone} from './model';
/** UI-independent snapshots; the editor adapter chooses transaction boundaries. */
export class PipelineHistory<T> {
  private past:T[]=[];private future:T[]=[];
  constructor(public current:T,private limit=40){this.current=clone(current);}
  commit(next:T){this.past.push(clone(this.current));if(this.past.length>this.limit)this.past.shift();this.future=[];this.current=clone(next);return clone(this.current);}
  undo(){if(this.past.length){this.future.push(clone(this.current));this.current=this.past.pop()!;}return clone(this.current);}
  redo(){if(this.future.length){this.past.push(clone(this.current));this.current=this.future.pop()!;}return clone(this.current);}
}
