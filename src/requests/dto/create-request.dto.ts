import { IsString, Length } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @Length(3, 200)
  title: string;

  @IsString()
  @Length(1, 5000)
  body: string;
}
