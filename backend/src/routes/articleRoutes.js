import {Router} from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import {asyncHandler} from '../utils/asyncHandler.js';
import {BadRequest,Forbidden} from '../utils/AppError.js';
import {articleQueue, reviewRecord, generateArticle, saveArticle} from '../services/articleReview.js';

const router = Router();
const uuid=Joi.string().uuid().required();
const limited=rateLimit({windowMs:60000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,keyGenerator:req=>req.user.id});
router.param('id',(req,res,next,id)=>next(uuid.validate(id).error ? BadRequest('Invalid story ID.') : undefined));
router.get('/',asyncHandler(async(req,res)=>{
  const {value,error}=Joi.object({after:Joi.string().uuid(),search:Joi.string().trim().max(120)}).validate(req.query);
  if(error) throw BadRequest('Invalid search or page.');
  res.json(await articleQueue(value.after,value.search));
}));
router.get('/:id',asyncHandler(async(req,res)=>{
  const row=await reviewRecord(req.params.id);
  const {sourceUrl,sourceName,...draft}=row.articleDraft || {};
  res.json({id:row.id,title:row.title,version:row.articleVersion,draft:row.articleDraft?draft:null,approvedAt:row.articleApprovedAt,evidence:row.articleEvidence,sourceUrl:sourceUrl||row.sources[0]?.rawDocument.url,source:sourceName||row.sources[0]?.rawDocument.source.name});
}));
function version(body) {
  if (!Number.isSafeInteger(body?.version) || body.version<0) throw BadRequest('Invalid draft version.');
  return body.version;
}
router.post('/:id/generate',limited,asyncHandler(async(req,res)=>res.json(await generateArticle(req.params.id,version(req.body)))));
router.put('/:id',asyncHandler(async(req,res)=>res.json(await saveArticle(req.params.id,version(req.body),req.body.article))));
router.post('/:id/publish',asyncHandler(async(req,res)=>{
  if(req.user.role!=='ADMIN') throw Forbidden('Administrator approval required.');
  res.json(await saveArticle(req.params.id,version(req.body),req.body.article,{publishBy:req.user.id}));
}));
export default router;

